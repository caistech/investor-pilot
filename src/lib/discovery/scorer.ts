/**
 * Per-candidate scorer + upsert helper.
 *
 * Lifted out of /api/pipeline/discover so both the single-query route and
 * the batch route can share the same scoring logic without HTTP-in-HTTP.
 *
 * One Claude one-shot call per candidate, scored against the v3 lender ICP.
 * Schema field names retained from v2 (audience_overlap_score etc.); semantics
 * remapped per Senior Debt Brief v3.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertPartner, computeWeightedScore } from '@/lib/db/partners';
import { braveWebSearch } from '@/lib/agent/brave-tools';

const client = new Anthropic({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY!,
  ...(process.env.OPENROUTER_API_KEY
    ? {
        baseURL: 'https://openrouter.ai/api',
        defaultHeaders: {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://investorpilot.vercel.app',
          'X-Title': 'InvestorPilot',
        },
      }
    : {}),
});

const MODEL = process.env.OPENROUTER_API_KEY
  ? process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4.5'
  : process.env.AGENT_MODEL || 'claude-sonnet-4-5';

export const SCORING_PROMPT = `You are a lender prospect scoring analyst for F2K's senior debt placement. Given a person/firm description from search results, score them on 5 dimensions for fit as a direct lender into Australian property development debt facilities ($1M-$5M cheques, first-mortgage senior secured, 8-11% p.a. coupon).

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

- complementarity_score (weight 25% — ASSET CLASS FOCUS): Construction finance / property development debt, with bonus weight for modular/prefab and cross-border deal history. 10/10 = construction-finance specialist with documented offshore or cross-border deals (Singapore/HK/US/UK/UAE funds with EM construction exposure). 7-9 = construction-finance specialist without explicit cross-border evidence. 5-7 = private debt focus but unclear if construction/property. 1-4 = wrong asset class (tech VC, equities, etc).

- strategic_leverage_score (weight 25% — TRACK RECORD): Documented construction-finance or real-estate-debt position in past 36 months, ESPECIALLY cross-border or offshore-funded. This is the STRONGEST predictor. 10/10 = public evidence (LinkedIn post, fund report, press) of recent offshore or cross-border construction finance, or modular/prefab construction lending. 7-9 = recent AU/domestic construction-debt position. 5-7 = some real-estate exposure but not specifically construction. 1-4 = no evidence of relevant lending history.

- partner_readiness_score (weight 15% — DECISION AUTHORITY + CADENCE): Personal allocation authority; decides in weeks not months. 10/10 = FO principal / CIO / personal capital / fund partner with offshore mandate flexibility. 5-7 = senior role at small private debt vehicle. 1-4 = analyst-level or slow committee gating.

- reachability_score (weight 10% — GEOGRAPHIC + LINKEDIN VISIBILITY): Singapore / Hong Kong / NYC / London / Dubai construction-finance specialists are HIGHEST (these are F2K's primary market). Miami / SF / other US financial hubs HIGH. Sydney / Melbourne MEDIUM-HIGH (AU secondary). Brisbane / Perth / other AU MEDIUM. Other regions LOW. 10/10 = primary-market construction-finance specialist with high LinkedIn visibility. 7-9 = right region or right specialism, both not both. 5-7 = AU domestic-only with thin offshore mandate. 1-4 = wrong geography AND wrong specialism.

REJECT (score 0-2 across the board, mark category as "out_of_scope"):
- Retail bank credit officers
- Mortgage brokers
- Equity-only family offices (no debt allocation)
- Tech / venture-focused family offices
- Public REIT managers
- Pure listed-equity advisors
- Generic financial advisors placing retail client money (this is the v2 advisor channel — out of scope in v3)
- Pure AU-domestic property credit funds with no offshore mandate flexibility AND no construction-finance track record (the AU paradigm-locked group F2K's structure doesn't fit)
- Bank-owned platforms (slow approval timelines)
- Retail mortgage trusts and listed mortgage funds

DO NOT REJECT (these were rejected in v2/v3 but are now in-scope for the international-primary ICP):
- Institutional debt funds >$1B AUM IF they have a Singapore/HK/US/UK construction-specialist desk — they routinely write $5-25M tranches in cross-border deals at exactly F2K's ticket size.
- Large family offices in Singapore/HK/Dubai that publicly engage on offshore construction or real-asset deals.

If a dimension relies more on inference than evidence, cap at 4/10 and set confidence_score to "low-confidence".`;

export interface ScoreCandidateInput {
  name: string;
  domain: string;
  description: string;
  source: 'linkedin' | 'sales_nav' | 'brave';
  contact_name?: string;
  contact_title?: string;
  contact_linkedin?: string;
  network_distance?: '1st' | '2nd' | 'cold';
}

export interface ScoreCandidateResult {
  company_name: string;
  domain: string;
  status: string;
  source: 'linkedin' | 'sales_nav' | 'brave';
  weighted_score?: number;
  partner_id?: string;
  network_distance?: '1st' | '2nd' | 'cold';
  error?: string;
}

/**
 * Brave evidence enrichment for LinkedIn-sourced candidates.
 *
 * LinkedIn gives us name + headline + current company but no deal history.
 * Brave can surface fund reports / press / news mentioning the company —
 * which is the strongest predictor for the v3 strategic_leverage score
 * (track record of AU property dev debt participation).
 *
 * Returns a short evidence block to inject into the Claude scoring prompt.
 * Cheap: one Brave call per LinkedIn-sourced candidate (~3 results × top 200
 * chars each). Brave-sourced candidates skip this — they already arrived
 * with web context.
 */
export async function enrichCandidateWithBrave(candidate: ScoreCandidateInput): Promise<string> {
  if (candidate.source !== 'linkedin' && candidate.source !== 'sales_nav') return '';

  // Best signal we have for company name on a LinkedIn hit: candidate.name
  // (we set it to current_company in the linkedInPersonToCandidate normaliser).
  const company = candidate.name?.trim();
  if (!company || company.length < 3) return '';

  // Bias the query toward credit/debt/lending signals — the v3 strategic
  // leverage dimension specifically.
  const query = `"${company}" Australia (property OR real estate) (private credit OR debt OR lending OR fund)`;

  // Hard 6s timeout — Brave latency went from ~2-3s to ~8s on 2026-05-15,
  // which blew past Vercel's 60s edge timeout when multiplied across 40
  // candidates. Better to drop slow enrichment than hang the whole batch.
  try {
    const results = await braveWebSearch(query, 3, AbortSignal.timeout(6000));
    if (!results.length) return '';
    const block = results
      .slice(0, 3)
      .map(r => `- ${r.title.slice(0, 120)}: ${r.description.slice(0, 200)}`)
      .join('\n');
    return `\n\nWEB EVIDENCE for ${company} (Brave search):\n${block}`;
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      console.warn(`[scorer] Brave enrichment timeout for ${company} after 6s`);
    }
    return '';
  }
}

/**
 * Run the Claude scoring one-shot for one candidate, then upsert as a partner
 * row. Idempotent on (organisation_id, domain) — re-running discovery on the
 * same candidate updates the row rather than duplicating it.
 *
 * LinkedIn-sourced hits land as status='contact_found' (the LI URL counts as
 * contact discovery). Brave-sourced hits land as status='scored' and require
 * the normal enrich step before outreach.
 */
export async function scoreAndUpsertCandidate(
  db: SupabaseClient,
  candidate: ScoreCandidateInput,
  productContext: string,
  organisation_id: string,
  product_id: string | null,
  project_id?: string | null,
  options?: { enrichWithBrave?: boolean },
): Promise<ScoreCandidateResult> {
  try {
    const personContext = candidate.contact_name
      ? `\nContact: ${candidate.contact_name}${candidate.contact_title ? ` — ${candidate.contact_title}` : ''}${candidate.contact_linkedin ? ` (${candidate.contact_linkedin})` : ''}`
      : '';

    // Brave-enrich LinkedIn hits with company-level deal/fund/news signal
    // before scoring. Opt-in only — adds a Brave call per LinkedIn candidate
    // which can push the batch over Vercel's function timeout. Worth it when
    // signal quality matters; skip for fast runs.
    const enrichment = options?.enrichWithBrave === true ? await enrichCandidateWithBrave(candidate) : '';

    // Hard 8s timeout — without this, a slow OpenRouter call (or hung HTTP
    // socket) can hold the route past Vercel's edge gateway budget and the
    // browser sees "Failed to fetch" with no status. Better to drop the
    // slow candidate than block the whole batch.
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 500,
        system: SCORING_PROMPT,
        messages: [{
          role: 'user',
          content: `${productContext}\n\nCandidate to score: ${candidate.name} (${candidate.domain})\nSource: ${candidate.source}${personContext}\nDescription: ${candidate.description || 'No description available'}${enrichment}`,
        }],
      },
      { signal: AbortSignal.timeout(8000) },
    );

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        company_name: candidate.name,
        domain: candidate.domain,
        source: candidate.source,
        status: 'error',
        error: 'Invalid scoring response',
      };
    }

    const scores = JSON.parse(jsonMatch[0]);

    // Hard cap for out_of_scope candidates. The prompt says "score 0-2
    // across the board" but Claude frequently returns 3-5 anyway, which
    // pushes weighted_score to 4-5/10 and pollutes the Prospects view.
    // Enforce the rejection deterministically here: if category resolves
    // to out_of_scope, cap every dimension at 2 BEFORE computing the
    // weighted score. The dimension notes stay (rationale is still useful)
    // but the score reflects the rejection.
    const isOutOfScope = typeof scores.category === 'string'
      && /out[_ -]?of[_ -]?scope/i.test(scores.category);
    const capDim = (raw: number | null | undefined) => {
      const n = typeof raw === 'number' ? raw : 0;
      return isOutOfScope ? Math.min(n, 2) : n;
    };

    const weightedScore = computeWeightedScore({
      audience_overlap: capDim(scores.audience_overlap_score),
      complementarity: capDim(scores.complementarity_score),
      partner_readiness: capDim(scores.partner_readiness_score),
      reachability: capDim(scores.reachability_score),
      strategic_leverage: capDim(scores.strategic_leverage_score),
    });

    // Whitelist partner_type against the DB CHECK constraint (migration 008).
    // Claude occasionally returns descriptors like "mortgage_broker" when
    // scoring out-of-scope candidates — the prompt template uses
    // "<lender>" as a placeholder hint, but the model sometimes substitutes
    // its own category label. Anything outside the allowed set silently
    // failed the upsert, losing ~45% of scored candidates. Default to
    // 'lender' for this v3 pipeline (callers are sourcing for lender
    // outreach); out_of_scope rows still get capped to score≤2 elsewhere.
    const ALLOWED_PARTNER_TYPES = new Set(['referral', 'integration', 'reseller', 'combination', 'lender']);
    const rawPartnerType = typeof scores.partner_type === 'string' ? scores.partner_type.toLowerCase().trim() : '';
    const partnerType = ALLOWED_PARTNER_TYPES.has(rawPartnerType) ? rawPartnerType : 'lender';

    const upsertResult = await upsertPartner(db, {
      organisation_id,
      product_id,
      project_id,
      company_name: candidate.name,
      domain: candidate.domain,
      category: scores.category || null,
      partner_type: partnerType,
      status: candidate.source === 'linkedin' || candidate.source === 'sales_nav'
        ? 'contact_found'
        : 'scored',
      source: candidate.source,
      weighted_score: weightedScore,
      confidence_score: scores.confidence_score || 'normal',
      audience_overlap_score: capDim(scores.audience_overlap_score),
      audience_overlap_notes: scores.audience_overlap_notes,
      complementarity_score: capDim(scores.complementarity_score),
      complementarity_notes: scores.complementarity_notes,
      partner_readiness_score: capDim(scores.partner_readiness_score),
      partner_readiness_notes: scores.partner_readiness_notes,
      reachability_score: capDim(scores.reachability_score),
      reachability_notes: scores.reachability_notes,
      strategic_leverage_score: capDim(scores.strategic_leverage_score),
      strategic_leverage_notes: scores.strategic_leverage_notes,
      contact_name: candidate.contact_name,
      contact_title: candidate.contact_title,
      contact_linkedin: candidate.contact_linkedin,
      network_distance: candidate.network_distance,
    });

    return {
      company_name: candidate.name,
      domain: candidate.domain,
      source: candidate.source,
      status: upsertResult.status,
      weighted_score: weightedScore,
      partner_id: upsertResult.partner_id,
      network_distance: candidate.network_distance,
      error: upsertResult.error,
    };
  } catch (err) {
    return {
      company_name: candidate.name,
      domain: candidate.domain,
      source: candidate.source,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
