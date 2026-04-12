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

const SCORING_PROMPT = `You are an investor prospect scoring analyst. Given a company description from search results, score it on 5 dimensions for investor distribution potential with the product described below.

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
  "category": "<prospect category>",
  "partner_type": "<referral or integration or reseller>"
}

Scoring rules:
- ADVISOR REACH (weight 30%): Size of client base, assets under management/advice?
- CLIENT PROFILE FIT (weight 25%): Do their clients match sophisticated/wholesale investor criteria?
- REGULATORY STANDING (weight 15%): AFSL holder, clean regulatory record? Tier 1 (8-10): AFSL holder, compliance team. Tier 2 (5-7): authorised representative. Tier 3 (2-4): limited regulatory info. No evidence (0-1).
- GEOGRAPHIC RELEVANCE (weight 15%): Australian market presence, state coverage?
- ENGAGEMENT LIKELIHOOD (weight 15%): Openness to new product referrals, history of alternative investments?

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
