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

import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertPartner, computeWeightedScore } from '@/lib/db/partners';
import { braveWebSearch, type MeterFor } from '@/lib/agent/brave-tools';
import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { meterTokens } from '@/lib/usage/events';

// SCORING_PROMPT was hardcoded here (and duplicated in discover/route.ts) prior
// to Phase C of the multi-tenant config layer. Both call sites now build the
// prompt at request time via buildScoringPrompt(product) from
// src/lib/pipeline/scoring-prompt.ts and pass it through to
// scoreAndUpsertCandidate as scoringSystemPrompt.

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
export async function enrichCandidateWithBrave(
  candidate: ScoreCandidateInput,
  meterFor?: MeterFor,
): Promise<string> {
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
    const results = await braveWebSearch(query, 3, AbortSignal.timeout(6000), meterFor);
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
  scoringSystemPrompt: string,
  organisation_id: string,
  product_id: string | null,
  project_id?: string | null,
  options?: {
    enrichWithBrave?: boolean;
    runId?: string | null;
    meterFor?: MeterFor;
    /**
     * Offering-aware fallback for partner_type when the LLM returns
     * an unrecognised label. Products target buyers; projects target
     * lenders (the legacy default). Caller passes the offering's
     * configured icp_partner_type when available; we use it before
     * falling back to the offering-kind heuristic.
     */
    defaultPartnerType?: string | null;
  },
): Promise<ScoreCandidateResult> {
  try {
    const personContext = candidate.contact_name
      ? `\nContact: ${candidate.contact_name}${candidate.contact_title ? ` — ${candidate.contact_title}` : ''}${candidate.contact_linkedin ? ` (${candidate.contact_linkedin})` : ''}`
      : '';

    // Brave-enrich LinkedIn hits with company-level deal/fund/news signal
    // before scoring. Opt-in only — adds a Brave call per LinkedIn candidate
    // which can push the batch over Vercel's function timeout. Worth it when
    // signal quality matters; skip for fast runs.
    const enrichment = options?.enrichWithBrave === true
      ? await enrichCandidateWithBrave(candidate, options.meterFor)
      : '';

    // Hard 10s timeout — without this, a slow OpenRouter call (or hung HTTP
    // socket) can hold the route past Vercel's edge gateway budget and the
    // browser sees "Failed to fetch" with no status. Better to drop the
    // slow candidate than block the whole batch. Bumped from 8s → 10s on
    // 2026-05-17 after a LingoPure Seed run reported 1/20 candidates
    // aborted at 8s; 8-wide concurrency × 3 chunks × 10s = 30s of LLM
    // wall, comfortably inside Vercel's 60s ceiling.
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 500,
        system: scoringSystemPrompt,
        messages: [{
          role: 'user',
          content: `${productContext}\n\nCandidate to score: ${candidate.name} (${candidate.domain})\nSource: ${candidate.source}${personContext}\nDescription: ${candidate.description || 'No description available'}${enrichment}`,
        }],
      },
      { signal: AbortSignal.timeout(10000) },
    );

    meterTokens(options?.meterFor, response, MODEL);

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
    //
    // ALSO: when the offering has a buyer_title and the LLM judges the
    // contact's title doesn't match it (buyer_title_match === 'no'),
    // force out_of_scope. The hard-gate text in the prompt asks the LLM
    // to apply this rule itself, but in practice it gives company-fit
    // (verticals / sector / stage) too much weight and a non-buyer
    // contact at a vertical-matching company gets rated 8-9. Forcing
    // the rejection here means the LLM only has to make the binary
    // title-match judgement; the math of the dimensions can no longer
    // outvote it.
    const buyerTitleMismatch = typeof scores.buyer_title_match === 'string'
      && scores.buyer_title_match.toLowerCase().trim() === 'no';
    const categoryClaimsOutOfScope = typeof scores.category === 'string'
      && /out[_ -]?of[_ -]?scope/i.test(scores.category);
    const isOutOfScope = categoryClaimsOutOfScope || buyerTitleMismatch;
    if (buyerTitleMismatch && !categoryClaimsOutOfScope) {
      // Promote the LLM's category to out_of_scope so downstream
      // filters (Prospects "Exclude out-of-scope" toggle) see the
      // honest verdict. Keep the LLM's notes about WHY it was a
      // mismatch — operator finds that more useful than the original
      // category string.
      scores.category = 'out_of_scope';
    }
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

    // Whitelist partner_type against the DB CHECK constraint
    // (migration 008 widened to allow 'lender'; migration 032 widens
    // to allow 'buyer' for product-side runs). Claude occasionally
    // returns descriptors like "mortgage_broker" or "decision_maker"
    // when scoring out-of-scope candidates — anything outside the
    // allowed set silently fails the upsert, losing ~45% of scored
    // candidates if not normalised. Fallback uses the offering-aware
    // defaultPartnerType (operator-configured icp_partner_type or the
    // route's project→'lender' / product→'buyer' heuristic) so a bad
    // LLM response on a Product run doesn't quietly land as 'lender'.
    const ALLOWED_PARTNER_TYPES = new Set(['referral', 'integration', 'reseller', 'combination', 'lender', 'buyer']);
    const rawPartnerType = typeof scores.partner_type === 'string' ? scores.partner_type.toLowerCase().trim() : '';
    const fallbackPartnerType = options?.defaultPartnerType
      && ALLOWED_PARTNER_TYPES.has(options.defaultPartnerType.toLowerCase().trim())
      ? options.defaultPartnerType.toLowerCase().trim()
      : project_id ? 'lender' : 'buyer';
    const partnerType = ALLOWED_PARTNER_TYPES.has(rawPartnerType) ? rawPartnerType : fallbackPartnerType;

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
      first_seen_in_run_id: options?.runId || null,
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
    const raw = err instanceof Error ? err.message : String(err);
    // Translate AbortSignal timeouts into operator-readable copy. The raw
    // "This operation was aborted" message tells the operator nothing
    // actionable. Same translation pattern used in the sequence generator
    // (see [[clarify-over-fail]] memory — never surface raw aborts).
    const message = /aborted|timeout/i.test(raw)
      ? `Scoring took >10s for this candidate — usually an OpenRouter congestion spike. Click "Find Investors" again to retry the failed ones (already-scored candidates skip automatically).`
      : raw;
    return {
      company_name: candidate.name,
      domain: candidate.domain,
      source: candidate.source,
      status: 'error',
      error: message,
    };
  }
}
