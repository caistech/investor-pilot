import Anthropic from '@anthropic-ai/sdk';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { braveWebSearch } from '@/lib/agent/brave-tools';
import { upsertPartner, computeWeightedScore } from '@/lib/db/partners';
import { NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY!,
  ...(process.env.OPENROUTER_API_KEY ? {
    baseURL: 'https://openrouter.ai/api',
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://investorpilot.vercel.app',
      'X-Title': 'InvestorPilot',
    },
  } : {}),
});

const MODEL = process.env.OPENROUTER_API_KEY
  ? (process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4-20250514')
  : (process.env.AGENT_MODEL || 'claude-sonnet-4-20250514');

// Lender ICP scoring prompt (v3, 2026-05-13) — per Senior Debt Brief v3 Section 4.
// Schema field names retained from v2 (audience_overlap_score etc) to avoid migration;
// semantics rewritten for senior-debt lender channel. See docs/sprint-0/09-f2k-best-fit-profile-DRAFT.md.
const SCORING_PROMPT = `You are a lender prospect scoring analyst for F2K's senior debt placement. Given a person/firm description from search results, score them on 5 dimensions for fit as a direct lender into Australian property development debt facilities ($1M-$5M cheques, first-mortgage senior secured, 8-11% p.a. coupon).

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "audience_overlap_score": <1-10>,
  "audience_overlap_notes": "<one sentence>",
  "complementarity_score": <1-10>,
  "complementarity_notes": "<one sentence>",
  "partner_readiness_score": <1-10>,
  "partner_readiness_notes": "<one sentence>",
  "reachability_score": <1-10>,
  "reachability_notes": "<one sentence>",
  "strategic_leverage_score": <1-10>,
  "strategic_leverage_notes": "<one sentence>",
  "confidence_score": "<normal or low-confidence>",
  "category": "<lender category — e.g. single family office | multi family office | private credit fund | HNW direct lender | SMSF private debt>",
  "partner_type": "<lender>"
}

Scoring dimensions (lender ICP per Senior Debt Brief v3):

- audience_overlap_score (weight 25% — CAPITAL + TICKET FIT): Does this lender write $1M-$5M cheques into private debt? 10/10 = documented $2-5M tickets regularly; capacity for $5M+. 5-7 = writes private debt but ticket size unclear or smaller. 1-4 = equity-only or institutional-scale only.

- complementarity_score (weight 25% — ASSET CLASS FOCUS): Australian property + development debt specifically. 10/10 = publicly engages on AU property dev debt; recent co-invests visible. 5-7 = private debt focus but unclear if AU property. 1-4 = wrong asset class (tech VC, equities, etc).

- strategic_leverage_score (weight 25% — TRACK RECORD): Has lent into ≥1 AU property dev facility in past 36 months. This is the STRONGEST predictor. 10/10 = documented public evidence (LinkedIn post, fund report, news mention) of recent AU property dev debt position. 5-7 = some AU property exposure but not specifically dev debt. 1-4 = no evidence of relevant lending history.

- partner_readiness_score (weight 15% — DECISION AUTHORITY + CADENCE): Personal allocation authority; decides in weeks not months. 10/10 = FO principal / CIO / personal capital. 5-7 = senior role at small private debt vehicle. 1-4 = analyst-level or slow committee gating.

- reachability_score (weight 10% — GEOGRAPHIC + LINKEDIN VISIBILITY): Sydney HIGHEST, Melbourne HIGH, Singapore HIGH, Brisbane/Perth/Hong Kong MEDIUM, other LOW. AND findable on LinkedIn with verifiable email. 10/10 = Sydney/Melb/Singapore + high LinkedIn visibility. 5-7 = right geography but thin LinkedIn presence. 1-4 = wrong geography or unreachable.

REJECT (score 0-2 across the board, mark category as "out_of_scope"):
- Retail bank credit officers
- Mortgage brokers
- Equity-only family offices (no debt allocation)
- Tech / venture-focused family offices
- Public REIT managers
- Pure listed-equity advisors
- Generic financial advisors placing retail client money (this is the v2 advisor channel — out of scope in v3)
- Large institutional debt funds >$1B AUM (too big for our $2.5M-$16.2M facilities)
- Bank-owned platforms (slow approval timelines)
- Retail mortgage trusts and listed mortgage funds

If a dimension relies more on inference than evidence, cap at 4/10 and set confidence_score to "low-confidence".`;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json();
  let { product_id, organisation_id, query, domains } = body as {
    product_id?: string;
    organisation_id?: string;
    query?: string;
    domains?: string[];
  };

  // Auto-resolve org and product from authenticated user if not provided
  if (!organisation_id || organisation_id === 'auto') {
    const { data: profile } = await db
      .from('profiles')
      .select('organisation_id')
      .eq('id', user!.id)
      .single();
    organisation_id = profile?.organisation_id;
  }
  if (!organisation_id) {
    return NextResponse.json({ error: 'Could not resolve organisation' }, { status: 400 });
  }

  if (!product_id || product_id === 'auto') {
    const { data: firstProduct } = await db
      .from('products')
      .select('id')
      .eq('organisation_id', organisation_id)
      .limit(1)
      .single();
    product_id = firstProduct?.id;
  }
  if (!product_id) {
    return NextResponse.json({ error: 'No product found. Create one in Products first.' }, { status: 400 });
  }

  // Load product for context
  const { data: product } = await db
    .from('products')
    .select('name, one_sentence_description, icp_company_size, icp_verticals, icp_buyer_title')
    .eq('id', product_id)
    .single();

  const productContext = product
    ? `Product: ${product.name}. ${product.one_sentence_description || ''}. ICP: ${product.icp_company_size || ''} companies in ${product.icp_verticals || ''}, buyer: ${product.icp_buyer_title || ''}.`
    : 'No product context available.';

  const results: Array<{ company_name: string; domain: string; status: string; weighted_score?: number; error?: string }> = [];

  // Source 1: Brave Search by query
  let companies: Array<{ name: string; domain: string; description: string }> = [];

  if (query) {
    try {
      const searchResults = await braveWebSearch(query, 10);
      companies = searchResults.map(r => {
        const url = new URL(r.url);
        return { name: r.title.split(' - ')[0].split(' | ')[0].trim(), domain: url.hostname.replace(/^www\./, ''), description: r.description };
      });
      // Deduplicate by domain
      const seen = new Set<string>();
      companies = companies.filter(c => {
        if (seen.has(c.domain)) return false;
        seen.add(c.domain);
        return true;
      });
    } catch (err) {
      return NextResponse.json({ error: `Search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  // Source 2: Seed list of domains
  if (domains && domains.length > 0) {
    for (const d of domains) {
      const clean = d.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (clean && !companies.some(c => c.domain === clean)) {
        companies.push({ name: clean, domain: clean, description: '' });
      }
    }
  }

  if (companies.length === 0) {
    return NextResponse.json({ error: 'No companies found. Provide a search query or domain list.' }, { status: 400 });
  }

  // Score each company via one-shot Claude call
  for (const company of companies.slice(0, 20)) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: SCORING_PROMPT,
        messages: [{
          role: 'user',
          content: `${productContext}\n\nCompany to score: ${company.name} (${company.domain})\nDescription: ${company.description || 'No description available'}`,
        }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        results.push({ company_name: company.name, domain: company.domain, status: 'error', error: 'Invalid scoring response' });
        continue;
      }

      const scores = JSON.parse(jsonMatch[0]);
      const weightedScore = computeWeightedScore({
        audience_overlap: scores.audience_overlap_score || 0,
        complementarity: scores.complementarity_score || 0,
        partner_readiness: scores.partner_readiness_score || 0,
        reachability: scores.reachability_score || 0,
        strategic_leverage: scores.strategic_leverage_score || 0,
      });

      const result = await upsertPartner(db, {
        organisation_id,
        product_id,
        company_name: company.name,
        domain: company.domain,
        category: scores.category || null,
        partner_type: scores.partner_type || 'referral',
        status: 'scored',
        weighted_score: weightedScore,
        confidence_score: scores.confidence_score || 'normal',
        audience_overlap_score: scores.audience_overlap_score,
        audience_overlap_notes: scores.audience_overlap_notes,
        complementarity_score: scores.complementarity_score,
        complementarity_notes: scores.complementarity_notes,
        partner_readiness_score: scores.partner_readiness_score,
        partner_readiness_notes: scores.partner_readiness_notes,
        reachability_score: scores.reachability_score,
        reachability_notes: scores.reachability_notes,
        strategic_leverage_score: scores.strategic_leverage_score,
        strategic_leverage_notes: scores.strategic_leverage_notes,
      });

      results.push({
        company_name: company.name,
        domain: company.domain,
        status: result.status,
        weighted_score: weightedScore,
        error: result.error,
      });
    } catch (err) {
      results.push({
        company_name: company.name,
        domain: company.domain,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    discovered: results.filter(r => r.status !== 'error').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  });
}
