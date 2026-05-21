/**
 * runDiscoveryBatch — single-source-of-truth discovery executor.
 *
 * Extracted from /api/pipeline/discover-batch/route.ts on 2026-05-21
 * when the route moved to the background-job pattern (migration 040
 * `discovery_jobs`). The original POST handler now writes a pending
 * `discovery_jobs` row and returns immediately; the cron worker
 * `/api/cron/run-discovery-jobs` picks the row up and calls this
 * function with the saved params.
 *
 * Keeping the logic here (not inlined into the cron worker) means:
 *   - The HTTP route still exists as a synchronous fallback for
 *     scripts / tooling that bypass the job queue.
 *   - Both call sites share identical discovery semantics — no risk
 *     of the cron drifting from what the operator's "Find Buyers"
 *     button used to do.
 *
 * Caller responsibilities:
 *   - Validate the request body / job params before calling.
 *   - Provide a service-client db (RLS bypassed; this function trusts
 *     organisation_id to be correct).
 *   - Provide created_by_user_id so audit_events records the actor.
 *
 * Wall-time discipline (per the wall-time-discipline memory):
 *   The cron worker call path runs against the 300s function ceiling
 *   so MAX_TOTAL_CANDIDATES can be set to 150. The synchronous route
 *   call path stays at 30 to fit under Vercel's 60s edge gateway wall.
 *   The cap is passed in explicitly via params.maxTotalCandidates.
 */

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { braveWebSearch } from '@/lib/agent/brave-tools';
import {
  searchLinkedInPeople,
  searchSalesNavigator,
  type LinkedInPerson,
} from '@/lib/channels/unipile';
import { scoreAndUpsertCandidate, type ScoreCandidateInput } from '@/lib/discovery/scorer';
import { buildScoringPrompt, type ScoringPromptProduct } from '@/lib/pipeline/scoring-prompt';
import { generateLenderQueries } from '@/lib/discovery/query-generator';
import { FUNDING_TYPE_BY_VALUE, PRODUCT_PROSPECT_TYPE_BY_VALUE, type FundingType } from '@/lib/types';
import { extractCompanyFromHeadline } from '@/lib/discovery/headline';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { isPublisherDomain } from '@/lib/discovery/publisher-domains';
import { looksLikeJunkBraveResult } from '@/lib/discovery/junk-result-filter';

export type DiscoverSource = 'linkedin' | 'sales_nav' | 'brave';
export type NetworkTier = '1st' | '2nd' | 'cold';

// 2026-05-21: bumped DEFAULT_QUERY_COUNT 6 → 10 alongside the 75/25
// Brave/LinkedIn re-balance in query-generator.ts. Brave is now the
// primary funnel for reachable prospects (real domains → cascade works);
// LinkedIn drops to 25% until the LinkedIn-URL → email path lands.
// At 10 total = ~2-3 LinkedIn + ~7-8 Brave queries per batch.
const DEFAULT_QUERY_COUNT = 10;
const SCORING_CONCURRENCY = 8;
const SEARCH_CONCURRENCY = 4;
const CANDIDATES_PER_QUERY = 25;
const BRAVE_CANDIDATES_PER_QUERY = 20;
const SEARCH_TIMEOUT_MS = 15_000;

const TIER_TO_LINKEDIN_DISTANCE: Record<NetworkTier, number[] | undefined> = {
  '1st': [1],
  '2nd': [2],
  'cold': undefined,
};

export interface DiscoveryBatchParams {
  product_id?: string;
  project_id?: string;
  query_count?: number;
  sources?: DiscoverSource[];
  network_tiers?: NetworkTier[];
  enrich_with_brave?: boolean;
  /**
   * Override for MAX_TOTAL_CANDIDATES. Defaults to 30 (the sync-route
   * value that fits the 60s edge wall). The cron worker passes 150 to
   * use the 300s function ceiling.
   */
  max_total_candidates?: number;
}

export interface DiscoveryBatchContext {
  db: SupabaseClient;
  organisation_id: string;
  created_by_user_id: string | null;
}

export interface DiscoveryBatchSuccess {
  ok: true;
  run_id: string;
  run_code: string;
  product_summary: string | null;
  queries_used: Array<{ query: string; rationale: string; category: string; intended_source: 'linkedin' | 'brave' }>;
  sources_used: DiscoverSource[];
  network_tiers_used: NetworkTier[];
  tier_breakdown: Record<NetworkTier, number>;
  candidates_found: number;
  candidates_unique: number;
  candidates_scored: number;
  candidates_failed: number;
  search_errors: Array<{ query: string; source: DiscoverSource; tier: NetworkTier; error: string }>;
  scoring_errors: string[];
  top_results: Array<{ company_name: string; weighted_score?: number; source: 'linkedin' | 'sales_nav' | 'brave'; partner_id?: string; network_distance?: NetworkTier }>;
}

export interface DiscoveryBatchFailure {
  ok: false;
  status: number;
  error: string;
  /** When the cap-check is the cause, the original capExceededResponse body */
  cap_exceeded?: ReturnType<typeof buildCapExceededResponse>;
}

export type DiscoveryBatchResult = DiscoveryBatchSuccess | DiscoveryBatchFailure;

/**
 * The shared discovery engine. Powers "Find Buyers" on the Products page
 * (sales side) and "Find Investors" on the Projects page (funding side).
 * The operator's offering profile drives the search vocabulary, scoring
 * rubric, and partner_type defaults — the engine itself is offering-
 * agnostic.
 *
 *   1. Reads the product/project + its Knowledge Base
 *   2. Generates N targeted lender search queries via Claude
 *   3. Runs each query across selected sources in parallel (LinkedIn primary,
 *      Brave supplement)
 *   4. Scores every de-duped candidate against the v3 lender ICP
 *   5. Persists everything to `partners`
 */
export async function runDiscoveryBatch(
  params: DiscoveryBatchParams,
  ctx: DiscoveryBatchContext,
): Promise<DiscoveryBatchResult> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const log = (phase: string, extra?: Record<string, unknown>) =>
    console.log(`[discover-batch] ${ms()}ms ${phase}${extra ? ' ' + JSON.stringify(extra) : ''}`);

  log('start');

  const { db, organisation_id } = ctx;
  let { product_id, project_id, query_count, sources, network_tiers } = params;
  const enrichWithBrave: boolean = params.enrich_with_brave === true;
  const MAX_TOTAL_CANDIDATES = params.max_total_candidates ?? 30;

  // Pre-flight cap check.
  const braveCap = await checkCap(organisation_id, 'brave_query');
  if (!braveCap.allowed) {
    return { ok: false, status: 429, error: 'brave_query cap exceeded', cap_exceeded: buildCapExceededResponse('brave_query', braveCap) };
  }
  const llmCap = await checkCap(organisation_id, 'llm_tokens');
  if (!llmCap.allowed) {
    return { ok: false, status: 429, error: 'llm_tokens cap exceeded', cap_exceeded: buildCapExceededResponse('llm_tokens', llmCap) };
  }
  const meterFor = { organisation_id, route: '/api/pipeline/discover-batch' };

  let offering: {
    id: string;
    name: string;
    description: string | null;
    one_sentence_description: string | null;
    core_mechanism: string | null;
    customer_outcomes: string | null;
    icp_company_size: string | null;
    icp_verticals: string | null;
    icp_buyer_title: string | null;
    icp_stage: string | null;
    exclusions: string | null;
    sponsor: string | null;
    project_type: string | null;
    funding_type: string | null;
    funding_target: string | null;
    geography: string | null;
    asset_class: string | null;
    product_pitch: string | null;
    scoring_rubric: string | null;
    icp_categories: string[] | null;
    icp_partner_type: string | null;
    icp_reject_categories: string[] | null;
    icp_special_cases: string[] | null;
  } | null = null;
  let kbSourceQuery: { table: 'product' | 'project'; id: string } | null = null;

  if (project_id) {
    if (project_id === 'auto') {
      const { data: firstProject } = await db
        .from('projects')
        .select('id')
        .eq('organisation_id', organisation_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      project_id = firstProject?.id;
    }
    if (!project_id) {
      return { ok: false, status: 400, error: 'No active project found' };
    }
    const { data: project } = await db
      .from('projects')
      .select('id, name, description, sponsor, project_type, funding_type, funding_target, geography, asset_class, core_mechanism, customer_outcomes, icp_company_size, icp_verticals, icp_buyer_title, icp_stage, exclusions, investment_thesis, scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases, query_history')
      .eq('id', project_id)
      .single();
    if (!project) {
      return { ok: false, status: 404, error: 'Project not found' };
    }
    offering = {
      ...project,
      one_sentence_description: null,
      product_pitch: project.investment_thesis ?? project.description ?? null,
    };
    kbSourceQuery = { table: 'project', id: project_id };
  } else {
    if (!product_id || product_id === 'auto') {
      const { data: firstProduct } = await db
        .from('products')
        .select('id')
        .eq('organisation_id', organisation_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      product_id = firstProduct?.id;
    }
    if (!product_id) {
      return { ok: false, status: 400, error: 'No active product or project found. Create one first.' };
    }
    const { data: product } = await db
      .from('products')
      .select('id, name, one_sentence_description, core_mechanism, customer_outcomes, icp_company_size, icp_verticals, icp_buyer_title, icp_stage, exclusions, product_pitch, scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases, asset_class, geography, query_history')
      .eq('id', product_id)
      .single();
    if (!product) {
      return { ok: false, status: 404, error: 'Product not found' };
    }
    offering = {
      ...product,
      description: null,
      sponsor: null,
      project_type: null,
      funding_type: null,
      funding_target: null,
      geography: null,
      asset_class: null,
    };
    kbSourceQuery = { table: 'product', id: product_id };
  }

  const { data: kbSources } = await db
    .from('product_sources')
    .select('title, source_type, url, content')
    .eq(kbSourceQuery.table === 'project' ? 'project_id' : 'product_id', kbSourceQuery.id)
    .eq('processing_status', 'completed');

  if (!sources || sources.length === 0) {
    const { data: linkedinChannel } = await db
      .from('client_channels')
      .select('id')
      .eq('organisation_id', organisation_id)
      .eq('channel_type', 'linkedin')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    sources = linkedinChannel ? ['linkedin'] : ['brave'];
  }

  const tiers: NetworkTier[] = network_tiers && network_tiers.length > 0
    ? network_tiers
    : ['1st', '2nd', 'cold'];

  // Insert the discovery_runs row up front. Status starts 'running'; finalised
  // on success or marked 'failed' on early-return paths below.
  const runId = randomUUID();
  const runCode = `DR-${runId.replace(/-/g, '').slice(0, 6).toLowerCase()}`;

  const { error: runInsertError } = await db
    .from('discovery_runs')
    .insert({
      id: runId,
      run_code: runCode,
      organisation_id,
      project_id: project_id || null,
      product_id: product_id || null,
      triggered_by: ctx.created_by_user_id,
      sources,
      network_tiers: tiers,
      enrich_with_brave: enrichWithBrave,
      query_count: query_count || DEFAULT_QUERY_COUNT,
      status: 'running',
    });

  if (runInsertError) {
    log('run_insert_failed', { error: runInsertError.message });
    return { ok: false, status: 500, error: `Failed to record discovery run: ${runInsertError.message}` };
  }

  log('run_started', { run_id: runId, run_code: runCode });

  const finaliseRun = async (
    status: 'completed' | 'failed',
    fields: Record<string, unknown>,
  ) => {
    await db
      .from('discovery_runs')
      .update({
        status,
        wall_time_ms: ms(),
        completed_at: new Date().toISOString(),
        ...fields,
      })
      .eq('id', runId);
  };

  // Generate queries via Claude.
  const queryGen = await generateLenderQueries({
    product: {
      name: offering.name,
      one_sentence_description: offering.one_sentence_description,
      description: offering.description,
      core_mechanism: offering.core_mechanism,
      customer_outcomes: offering.customer_outcomes,
      icp_company_size: offering.icp_company_size,
      icp_verticals: offering.icp_verticals,
      icp_buyer_title: offering.icp_buyer_title,
      icp_stage: offering.icp_stage,
      exclusions: offering.exclusions,
      sponsor: offering.sponsor,
      project_type: offering.project_type,
      funding_type: offering.funding_type,
      funding_type_describe: offering.funding_type
        ? FUNDING_TYPE_BY_VALUE[offering.funding_type as FundingType]?.describe ?? null
        : null,
      funding_target: offering.funding_target,
      geography: offering.geography,
      asset_class: offering.asset_class,
      prospect_type: offering.icp_partner_type,
      prospect_type_describe: offering.icp_partner_type
        ? PRODUCT_PROSPECT_TYPE_BY_VALUE[offering.icp_partner_type]?.describe ?? null
        : null,
    },
    knowledgeBase: (kbSources || []).map(s => ({
      title: s.title,
      source_type: s.source_type,
      url: s.url,
      content: s.content,
    })),
    count: query_count || DEFAULT_QUERY_COUNT,
    meterFor,
    priorQueries: Array.isArray((offering as unknown as { query_history?: Array<{ query: string }> }).query_history)
      ? ((offering as unknown as { query_history: Array<{ query: string }> }).query_history)
          .map(h => h?.query)
          .filter((q): q is string => typeof q === 'string')
      : [],
  });

  if (!queryGen.ok) {
    log('query_gen_failed', { error: queryGen.error });
    await finaliseRun('failed', { search_errors: [{ stage: 'query_gen', error: queryGen.error }] });
    return { ok: false, status: 502, error: `Query generation failed: ${queryGen.error}` };
  }
  log('query_gen_done', {
    linkedin_queries: queryGen.linkedin_queries.length,
    brave_queries: queryGen.brave_queries.length,
  });

  let linkedinAccountId: string | null = null;
  if (sources.some(s => s === 'linkedin' || s === 'sales_nav')) {
    const { data: channel } = await db
      .from('client_channels')
      .select('oauth_token_ref')
      .eq('organisation_id', organisation_id)
      .eq('channel_type', 'linkedin')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    linkedinAccountId = channel?.oauth_token_ref || null;
  }

  // Compute per-query Brave offset from the offering's query_history.
  const priorHistory: Array<{ query?: string; offset?: number }> =
    Array.isArray((offering as unknown as { query_history?: unknown }).query_history)
      ? ((offering as unknown as { query_history: Array<{ query?: string; offset?: number }> }).query_history)
      : [];
  const offsetByQuery = new Map<string, number>();
  for (const entry of priorHistory) {
    if (typeof entry?.query !== 'string') continue;
    const next = (offsetByQuery.get(entry.query) ?? -1) + 1;
    offsetByQuery.set(entry.query, next);
  }

  const jobs: Array<{ query: string; source: DiscoverSource; tier: NetworkTier; offset?: number }> = [];
  for (const source of sources) {
    if (source === 'brave') {
      for (const q of queryGen.brave_queries) {
        const offset = offsetByQuery.get(q.query) ?? 0;
        jobs.push({ query: q.query, source, tier: 'cold', offset });
      }
    } else {
      for (const q of queryGen.linkedin_queries) {
        for (const tier of tiers) {
          jobs.push({ query: q.query, source, tier });
        }
      }
    }
  }

  const allCandidates: ScoreCandidateInput[] = [];
  const errors: Array<{ query: string; source: DiscoverSource; tier: NetworkTier; error: string }> = [];

  for (let i = 0; i < jobs.length; i += SEARCH_CONCURRENCY) {
    const batch = jobs.slice(i, i + SEARCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(j => withTimeout(fetchCandidates(j, linkedinAccountId, meterFor), SEARCH_TIMEOUT_MS, j))
    );
    results.forEach((r, idx) => {
      const job = batch[idx];
      if (r.status === 'fulfilled') {
        if (r.value.ok) {
          allCandidates.push(...r.value.candidates);
        } else {
          errors.push({ query: job.query, source: job.source, tier: job.tier, error: r.value.error });
        }
      } else {
        errors.push({ query: job.query, source: job.source, tier: job.tier, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      }
    });
  }

  // De-dup across queries.
  const TIER_RANK: Record<NetworkTier, number> = { '1st': 0, '2nd': 1, 'cold': 2 };
  const seen = new Map<string, ScoreCandidateInput>();
  for (const c of allCandidates) {
    const key = (c.contact_linkedin || c.domain).toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, c);
      continue;
    }
    if (existing.source === 'brave' && (c.source === 'linkedin' || c.source === 'sales_nav')) {
      seen.set(key, c);
      continue;
    }
    if (
      existing.source !== 'brave' &&
      c.source !== 'brave' &&
      c.network_distance &&
      existing.network_distance &&
      TIER_RANK[c.network_distance] < TIER_RANK[existing.network_distance]
    ) {
      seen.set(key, c);
    }
  }

  const dedupedInRun = Array.from(seen.values());

  // Pre-score dedup against existing partners.
  let preScoreDedupDropped = 0;
  let uniqueCandidates = dedupedInRun;
  {
    const candidateDomains = dedupedInRun
      .map(c => (c.domain || '').toLowerCase().replace(/^www\./, ''))
      .filter(Boolean);
    if (candidateDomains.length > 0) {
      const { data: existingPartners } = await db
        .from('partners')
        .select('domain')
        .eq('organisation_id', organisation_id)
        .in('domain', Array.from(new Set(candidateDomains)));
      const existingDomainSet = new Set(
        (existingPartners || [])
          .map(p => typeof p.domain === 'string' ? p.domain.toLowerCase().replace(/^www\./, '') : '')
          .filter(Boolean)
      );
      if (existingDomainSet.size > 0) {
        uniqueCandidates = dedupedInRun.filter(c => {
          const d = (c.domain || '').toLowerCase().replace(/^www\./, '');
          if (existingDomainSet.has(d)) {
            preScoreDedupDropped += 1;
            return false;
          }
          return true;
        });
      }
    }
  }
  uniqueCandidates = uniqueCandidates.slice(0, MAX_TOTAL_CANDIDATES);

  log('searches_done', {
    candidates_found: allCandidates.length,
    candidates_unique_in_run: dedupedInRun.length,
    candidates_dropped_already_in_db: preScoreDedupDropped,
    candidates_to_score: uniqueCandidates.length,
    search_errors: errors.length,
  });

  // Score everything.
  const offeringDescription = offering.description || offering.one_sentence_description || '';
  const projectMeta = offering.sponsor || offering.funding_target || offering.geography
    ? ` Sponsor: ${offering.sponsor || '—'}. Funding: ${offering.funding_target || '—'}. Geography: ${offering.geography || '—'}. Asset class: ${offering.asset_class || '—'}.`
    : '';
  const productContext = `Offering: ${offering.name}. ${offeringDescription}.${projectMeta} ICP: ${offering.icp_company_size || ''} firms in ${offering.icp_verticals || ''}, buyer: ${offering.icp_buyer_title || ''}.`;

  let scoringSystemPrompt: string;
  try {
    const scoringInput: ScoringPromptProduct = {
      ...(offering as unknown as ScoringPromptProduct),
      funding_type: offering.funding_type,
      funding_type_describe: offering.funding_type
        ? FUNDING_TYPE_BY_VALUE[offering.funding_type as FundingType]?.describe ?? null
        : null,
      icp_buyer_title: offering.icp_buyer_title,
      icp_verticals: offering.icp_verticals,
      icp_company_size: offering.icp_company_size,
      icp_stage: offering.icp_stage,
      exclusions: offering.exclusions,
      customer_outcomes: offering.customer_outcomes,
      core_mechanism: offering.core_mechanism,
    };
    scoringSystemPrompt = buildScoringPrompt(scoringInput);
  } catch (err) {
    await finaliseRun('failed', { search_errors: [{ stage: 'scoring_prompt', error: err instanceof Error ? err.message : String(err) }] });
    return { ok: false, status: 400, error: err instanceof Error ? err.message : String(err) };
  }

  const scoredResults: Awaited<ReturnType<typeof scoreAndUpsertCandidate>>[] = [];
  for (let i = 0; i < uniqueCandidates.length; i += SCORING_CONCURRENCY) {
    const batchStart = Date.now();
    const batch = uniqueCandidates.slice(i, i + SCORING_CONCURRENCY);
    const results = await Promise.all(
      batch.map(c => scoreAndUpsertCandidate(db, c, productContext, scoringSystemPrompt, organisation_id, product_id || null, project_id || null, {
        enrichWithBrave,
        runId,
        meterFor,
        defaultPartnerType: offering.icp_partner_type ?? null,
        icpTitles: offering.icp_buyer_title
          ? offering.icp_buyer_title.split(',').map(t => t.trim()).filter(Boolean)
          : undefined,
      }))
    );
    scoredResults.push(...results);
    log('scoring_batch_done', {
      batch_index: i / SCORING_CONCURRENCY,
      batch_size: batch.length,
      batch_ms: Date.now() - batchStart,
      ok: results.filter(r => r.status !== 'error').length,
      errors: results.filter(r => r.status === 'error').length,
    });
  }

  const topResults = scoredResults
    .filter(r => r.status !== 'error' && typeof r.weighted_score === 'number')
    .sort((a, b) => (b.weighted_score || 0) - (a.weighted_score || 0))
    .slice(0, 20)
    .map(r => ({
      company_name: r.company_name,
      weighted_score: r.weighted_score,
      source: r.source,
      partner_id: r.partner_id,
      network_distance: r.network_distance,
    }));

  const tierBreakdown: Record<NetworkTier, number> = { '1st': 0, '2nd': 0, 'cold': 0 };
  for (const r of scoredResults) {
    if (r.status !== 'error' && r.network_distance) {
      tierBreakdown[r.network_distance] = (tierBreakdown[r.network_distance] || 0) + 1;
    }
  }

  const scoringErrorSamples = Array.from(
    new Set(
      scoredResults
        .filter(r => r.status === 'error' && r.error)
        .map(r => r.error as string),
    ),
  ).slice(0, 5);

  await db.from('audit_events').insert({
    organisation_id,
    actor: ctx.created_by_user_id ? `user:${ctx.created_by_user_id}` : 'system:cron',
    action: 'discovery.batch_run',
    resource_type: 'product',
    resource_id: product_id,
    payload: {
      linkedin_query_count: queryGen.linkedin_queries.length,
      brave_query_count: queryGen.brave_queries.length,
      sources,
      candidates_found: allCandidates.length,
      candidates_unique: uniqueCandidates.length,
      candidates_scored: scoredResults.filter(r => r.status !== 'error').length,
      search_errors: errors.length,
    },
  });

  const queriesUsed = [
    ...queryGen.linkedin_queries.map(q => ({ query: q.query, rationale: q.rationale, category: q.expected_category, intended_source: 'linkedin' as const })),
    ...queryGen.brave_queries.map(q => ({ query: q.query, rationale: q.rationale, category: q.expected_category, intended_source: 'brave' as const })),
  ];

  const candidatesScored = scoredResults.filter(r => r.status !== 'error').length;
  const candidatesFailed = scoredResults.filter(r => r.status === 'error').length;
  const discardedCount = scoredResults.filter(r => r.status === 'discarded').length;

  log('done', {
    candidates_scored: candidatesScored,
    candidates_failed: candidatesFailed,
    candidates_discarded: discardedCount,
  });

  await finaliseRun('completed', {
    candidates_found: allCandidates.length,
    candidates_unique: uniqueCandidates.length,
    candidates_scored: candidatesScored,
    candidates_failed: candidatesFailed,
    queries_used: queriesUsed,
    search_errors: errors,
    scoring_errors: scoringErrorSamples,
  });

  // Persist updated query_history.
  try {
    const newHistoryEntries: Array<{ query: string; source: 'brave' | 'linkedin'; offset: number; used_at: string }> = [];
    const usedAt = new Date().toISOString();
    for (const j of jobs) {
      if (j.source === 'brave' || j.source === 'linkedin' || j.source === 'sales_nav') {
        newHistoryEntries.push({
          query: j.query,
          source: j.source === 'brave' ? 'brave' : 'linkedin',
          offset: j.offset || 0,
          used_at: usedAt,
        });
      }
    }
    if (newHistoryEntries.length > 0) {
      const merged = [...priorHistory, ...newHistoryEntries].slice(-60);
      const table = kbSourceQuery.table === 'project' ? 'projects' : 'products';
      const id = kbSourceQuery.table === 'project' ? project_id : product_id;
      await db.from(table).update({ query_history: merged }).eq('id', id).eq('organisation_id', organisation_id);
    }
  } catch (err) {
    console.error('[discover-batch] Failed to persist query_history:', err);
  }

  return {
    ok: true,
    run_id: runId,
    run_code: runCode,
    product_summary: queryGen.product_summary,
    queries_used: queriesUsed,
    sources_used: sources,
    network_tiers_used: tiers,
    tier_breakdown: tierBreakdown,
    candidates_found: allCandidates.length,
    candidates_unique: uniqueCandidates.length,
    candidates_scored: candidatesScored,
    candidates_failed: candidatesFailed,
    search_errors: errors,
    scoring_errors: scoringErrorSamples,
    top_results: topResults,
  };
}

/**
 * Wrap any promise with a hard timeout. Used per-search call so a hung
 * Unipile request can't block the entire batch's wall clock budget.
 */
function withTimeout(
  p: Promise<{ ok: true; candidates: ScoreCandidateInput[] } | { ok: false; error: string }>,
  ms: number,
  job: { query: string; source: DiscoverSource; tier: NetworkTier },
): Promise<{ ok: true; candidates: ScoreCandidateInput[] } | { ok: false; error: string }> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: `Search timed out after ${ms}ms for ${job.source}/${job.tier} "${job.query}"` });
    }, ms);
    p.then(result => {
      clearTimeout(timer);
      resolve(result);
    }).catch(err => {
      clearTimeout(timer);
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  });
}

async function fetchCandidates(
  job: { query: string; source: DiscoverSource; tier: NetworkTier; offset?: number },
  linkedinAccountId: string | null,
  meterFor: { organisation_id: string; route: string },
): Promise<
  { ok: true; candidates: ScoreCandidateInput[] } | { ok: false; error: string }
> {
  if (job.source === 'linkedin' || job.source === 'sales_nav') {
    if (!linkedinAccountId) {
      return { ok: false, error: `${job.source} requested but no LinkedIn channel connected` };
    }
    const distance = TIER_TO_LINKEDIN_DISTANCE[job.tier];
    const filters: { keywords: string; limit: number; network_distance?: number[] } = {
      keywords: job.query,
      limit: CANDIDATES_PER_QUERY,
    };
    if (distance) filters.network_distance = distance;
    const result =
      job.source === 'sales_nav'
        ? await searchSalesNavigator({ account_id: linkedinAccountId, filters })
        : await searchLinkedInPeople({ account_id: linkedinAccountId, filters });
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      candidates: result.people.map(p => linkedInPersonToCandidate(p, job.source, job.tier)),
    };
  }

  try {
    const searchResults = await braveWebSearch(job.query, BRAVE_CANDIDATES_PER_QUERY, undefined, meterFor, job.offset || 0);
    let droppedPublisher = 0;
    let droppedJunk = 0;
    const filtered = searchResults.filter(r => {
      try {
        const host = new URL(r.url).hostname;
        if (isPublisherDomain(host)) {
          droppedPublisher += 1;
          return false;
        }
      } catch {
        droppedJunk += 1;
        return false;
      }
      if (looksLikeJunkBraveResult(r.title, r.url)) {
        droppedJunk += 1;
        return false;
      }
      return true;
    });
    const totalDropped = droppedPublisher + droppedJunk;
    if (totalDropped > 0) {
      console.log(`[discover-batch] Brave query "${job.query}": dropped ${totalDropped} (publisher: ${droppedPublisher}, junk: ${droppedJunk}) — kept ${filtered.length}/${searchResults.length}`);
    }
    const candidates = filtered.map(r => {
      const url = new URL(r.url);
      return {
        name: r.title.split(' - ')[0].split(' | ')[0].trim(),
        domain: url.hostname.replace(/^www\./, ''),
        description: r.description,
        source: 'brave' as const,
        network_distance: 'cold' as const,
      };
    });
    return { ok: true, candidates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function linkedInPersonToCandidate(
  person: LinkedInPerson,
  source: DiscoverSource,
  tier: NetworkTier,
): ScoreCandidateInput {
  const domainFromCompany = person.current_company_domain
    ? person.current_company_domain
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
    : null;

  const domain =
    domainFromCompany ||
    (person.public_id ? `linkedin.com/in/${person.public_id}` : `linkedin-unknown-${Math.random().toString(36).slice(2, 10)}`);

  const description = [
    person.headline,
    person.current_company ? `Current: ${person.current_company}` : null,
    person.location ? `Location: ${person.location}` : null,
    person.industry ? `Industry: ${person.industry}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const companyName = person.current_company || extractCompanyFromHeadline(person.headline) || person.full_name;

  return {
    name: companyName,
    domain,
    description,
    source,
    contact_name: person.full_name || undefined,
    contact_title: person.headline || undefined,
    contact_linkedin: person.profile_url || undefined,
    network_distance: tier,
  };
}
