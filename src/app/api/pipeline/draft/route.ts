import Anthropic from '@anthropic-ai/sdk';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { saveDraft } from '@/lib/db/partners';
import { getProductWebsiteUrl } from '@/lib/agent/sources';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

// Wall-time guards. Default partner count is now batched 4-wide with per-call
// timeouts so an outlier Claude response can't block the whole request and
// push us past Vercel's 60s edge ceiling.
const MAX_PARTNERS_PER_REQUEST = 20;
const DRAFT_CONCURRENCY = 4;
const CLAUDE_TIMEOUT_MS = 8_000;

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
  ? (process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4.5')
  : (process.env.AGENT_MODEL || 'claude-sonnet-4-5');

// Lender-channel draft prompt (v3, 2026-05-13) — per Senior Debt Brief v3 + docs/sprint-0/07-draft-email-message.md
const DRAFT_PROMPT = `You are an outreach email writer for F2K's senior debt placement. Write a personalised cold credit-conversation email to a direct lender or family office private debt allocator about participation in F2K's senior debt facilities.

This is a CREDIT CONVERSATION, not a product-suitability conversation. The recipient is the decision-maker (lender), not someone placing other people's money. They expect concrete facility specifics — size, indicative rate, LVR, security, term, exit — and a sponsor track record citation.

Return ONLY a JSON object (no markdown, no explanation):
{
  "subject": "<concrete, project-specific subject line — names a facility size and the lender's relevant credit-signal>",
  "body": "<email body, under 200 words>",
  "partnership_motion": "<senior debt syndication | first-mortgage participation | combined platform position | individual facility>",
  "selected_gtm_angle": "<one sentence describing the lender's likely fit angle>"
}

EMAIL RULES:
- Subject: concrete, mentions facility size and/or specific project. Examples: "James — F2K $18.7M senior debt across two AU property projects" / "James — $2.5M WA land senior debt, first-mortgage, signed Coop Agreement"
- Opening: one sentence grounded in the lender's documented credit history (the "credit signal" — e.g., reference their public participation in a prior AU property debt facility)
- Body: lead with concrete facility specifics:
    * Branscombe Estate (Claremont TAS) — $16.2M senior construction, 8.5% p.a. indicative + 1% line + 1% establishment + 0.5% exit, ~22 months, first-mortgage, 40% anchor offtake to Homes Tasmania
    * Seafields Estate (Geraldton WA) — $2.5M senior land, 8.0% p.a. capitalised, Day-1 LVR 71% dropping to 24% within 6 months, first-mortgage over all 141 lots, signed tri-party Cooperation Agreement 19 Mar 2026
    * Combined $18.7M platform with TAS+WA geographic + construction+subdivision product diversification
- Choose lead facility per lender ticket size:
    * Large ($3M+ ticket band) → combined platform pitch
    * Mid ($1-3M) → standard pitch with both facilities
    * Smaller (sub-$1M) → Seafields-led only
- Ask: one specific low-commitment next step — "20-minute credit conversation" + calendar link
- Length: under 200 words
- Tone: professional, founder-to-credit-principal. Direct, factual, no hype.
- Signature: Dennis McMahon | Development Manager, Factory2Key Pty Ltd | F2K Capital

FORBIDDEN (these will be rejected):
- "guaranteed" / "risk-free" / "no risk"
- specific % returns beyond IM rates (8.5% Branscombe, 8.0% Seafields are pre-approved; any other % is forbidden)
- specific raise amounts beyond confirmed figures ($16.2M, $2.5M, $18.7M, $25.15M GRV, $21.15M GRV, $500K M0 deposit, $200K sponsor advance)
- "tokenisation" / "tokenised" / "crypto" / "blockchain" / "RWA" / "on-chain" (deferred — do not surface unprompted per Sec 5.7 of brief)
- "retail" / "your clients" (this is direct-lender outreach, lender IS principal)
- "advisor" / "advise" (this is credit, not advisory product)
- "I hope this finds you well", "synergy", "mutual benefit", "exciting opportunity", "limited time", "exclusive", "act now"
- emojis anywhere

NEVER:
- Fabricate specific claims about the lender's prior deals (only cite what's in the discovery evidence)
- Mention Stamford Capital or Front Financial in cold outreach (Sec 5.5 — soft framing in cold, direct in conversation)
- Mention the GREH tokenised fund unprompted (Sec 5.7 — only address if lender raises it)`;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { partner_ids, organisation_id, product_id } = await request.json() as {
    partner_ids: string[];
    organisation_id: string;
    product_id: string;
  };

  if (!partner_ids?.length || !organisation_id || !product_id) {
    return NextResponse.json({ error: 'partner_ids[], organisation_id, and product_id required' }, { status: 400 });
  }

  if (partner_ids.length > MAX_PARTNERS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many partners — pass at most ${MAX_PARTNERS_PER_REQUEST} per call (got ${partner_ids.length}). Split into batches to stay under the 60s function ceiling.`,
      },
      { status: 400 },
    );
  }

  // Load product and its website URL
  const [{ data: product }, productUrl] = await Promise.all([
    db.from('products')
      .select('name, one_sentence_description, core_mechanism, customer_outcomes')
      .eq('id', product_id)
      .single(),
    getProductWebsiteUrl(product_id),
  ]);

  const productContext = product
    ? `Product: ${product.name}. ${product.one_sentence_description || ''}. Core: ${product.core_mechanism || ''}. Outcomes: ${product.customer_outcomes || ''}.${productUrl ? ` Product website: ${productUrl}` : ''}`
    : '';

  // Load partners
  const { data: partners } = await db
    .from('partners')
    .select('id, company_name, domain, category, contact_name, contact_title, contact_email, weighted_score, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .in('id', partner_ids)
    .eq('organisation_id', organisation_id);

  if (!partners?.length) {
    return NextResponse.json({ error: 'No partners found' }, { status: 404 });
  }

  const results: Array<{
    partner_id: string;
    company_name: string;
    status: string;
    subject?: string;
    error?: string;
  }> = [];

  // Parallel batches with per-call timeouts. Previously fully sequential —
  // for 20 partners × ~4s Claude that's 80s, well over Vercel's 60s edge
  // ceiling. 4-wide concurrency × ~4s per call = ~20s for 20 partners,
  // even with stragglers.
  type PartnerRow = NonNullable<typeof partners>[number];
  async function draftOne(partner: PartnerRow) {
    if (!partner.contact_email) {
      return {
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'skipped',
        error: 'No contact email',
      };
    }

    try {
      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: 500,
          system: DRAFT_PROMPT,
          messages: [{
            role: 'user',
            content: `${productContext}

Partner: ${partner.company_name} (${partner.domain})
Category: ${partner.category || 'Unknown'}
Contact: ${partner.contact_name || 'Unknown'}, ${partner.contact_title || 'Unknown'}
Score: ${partner.weighted_score || 'N/A'}
Audience overlap: ${partner.audience_overlap_notes || 'No notes'}
Complementarity: ${partner.complementarity_notes || 'No notes'}
Readiness: ${partner.partner_readiness_notes || 'No notes'}`,
          }],
        },
        { signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS) },
      );

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { partner_id: partner.id, company_name: partner.company_name, status: 'error', error: 'Invalid draft response' };
      }

      const draft = JSON.parse(jsonMatch[0]);

      await saveDraft(db!, organisation_id, partner.domain, {
        draft_subject: draft.subject,
        draft_body: draft.body,
        partnership_motion: draft.partnership_motion,
        selected_gtm_angle: draft.selected_gtm_angle,
      });

      return {
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'drafted',
        subject: draft.subject,
      };
    } catch (err) {
      await db!.from('partners').update({
        draft_status: 'none',
        last_updated_at: new Date().toISOString(),
      }).eq('id', partner.id);

      return {
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  for (let i = 0; i < partners.length; i += DRAFT_CONCURRENCY) {
    const slice = partners.slice(i, i + DRAFT_CONCURRENCY);
    const batch = await Promise.all(slice.map(draftOne));
    results.push(...batch);
  }

  return NextResponse.json({
    drafted: results.filter(r => r.status === 'drafted').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  });
}
