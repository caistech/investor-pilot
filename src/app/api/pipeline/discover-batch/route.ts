/**
 * POST /api/pipeline/discover-batch
 *
 * The shared discovery engine. Powers "Find Buyers" on the Products
 * page (sales side) and "Find Investors" on the Projects page
 * (funding side). The operator's offering profile drives the search
 * vocabulary, scoring rubric, and partner_type defaults — the engine
 * itself is offering-agnostic.
 *
 *   1. Reads the product + its Knowledge Base
 *   2. Generates N targeted lender search queries via Claude
 *   3. Runs each query across selected sources in parallel (LinkedIn primary,
 *      Brave supplement)
 *   4. Scores every de-duped candidate against the v3 lender ICP
 *   5. Persists everything to `partners`
 *
 * Time budget: maxDuration 300s (Vercel Pro). For larger batches use the
 * background-job pattern (Phase 3 — discovery_jobs table not yet built).
 *
 * Body:
 *   { product_id?: 'auto' | uuid, query_count?: 3-15, sources?: ['linkedin' | 'sales_nav' | 'brave'] }
 *
 * Returns:
 *   { ok, queries_used, candidates_found, candidates_scored, candidates_failed,
 *     top_results: [{ company_name, weighted_score, source, partner_id }, ...] }
 */

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
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
import { getLinkedInProfile } from '@/lib/channels/unipile';
// hunterDomainSearch is no longer called from this route — Hunter is
// now inline in scoreAndUpsertCandidate (parallel with LLM scoring).
// Keeping the import would trigger a lint warning. The function still
// lives in @/lib/agent/hunter-tools for other callers (refresh-enrichment).
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { isPublisherDomain } from '@/lib/discovery/publisher-domains';
import { looksLikeJunkBraveResult } from '@/lib/discovery/junk-result-filter';

export const maxDuration = 300; // 5 min, Vercel Pro limit

type DiscoverSource = 'linkedin' | 'sales_nav' | 'brave';
type NetworkTier = '1st' | '2nd' | 'cold';

// Default workload tuned to finish reliably under 45s. Operator can request
// bigger batches via explicit body params.
//
// maxDuration is also forced to 300s via vercel.json (the `functions` config
// doesn't rely on the export being parsed at deploy time).
// Defaults tightened on 2026-05-15 after Brave latency degraded ~3x (from
// ~2-3s to ~8s per call), which pushed total wall time past Vercel's 60s
// edge gateway budget. Then re-broadened later same day: operator noted that
// a simple "real estate fund" web search returns thousands of results while
// our discover was returning zero from Brave — too few queries, too few
// results per query. Current numbers target ~45-55s wall time with much
// more inventory surfaced.
// Wall-time budget audit (revised 2026-05-15 evening):
//   Searches: 6 queries × 3 tiers (LinkedIn) + 3 Brave = ~21 jobs
//     → 4-wide concurrency × ~5-12s each = 25-35s
//   Scoring: up to 20 candidates × ~4s / 8 concurrent = ~10-15s
//   Hunter (Brave only, top 8 by score): ~5s × 8/4 = ~10s
//   Total target: ~50-60s. Stays under Vercel's 60s client-edge timeout.
// LinkedIn profile-only enrichment moved to a separate operator-triggered
// endpoint (was costing another ~10s here and pushed total over).
// Wall-time budget (with maxDuration=300s via vercel.json — Vercel Pro):
//   Searches: 10 queries × 3 tiers × 25 LinkedIn = up to 750 person-results
//             + 10 queries × 25 Brave = up to 250 page-results. With
//             SEARCH_CONCURRENCY=4 and ~5-12s per call, ~60-90s wall.
//   Scoring: up to 150 candidates × ~4s / 8 concurrent = ~75s.
//   Hunter (top 20 Brave): ~5s × 20 / 4-wide = ~25s.
//   Total target: ~180-200s, well inside the 300s ceiling.
//
// The 20-cap that was here before was a wall-time guard back when
// maxDuration was 60s. With 300s available, the cap was making
// discovery look broken on common B2B ICPs (10–500 employee
// operationally-heavy businesses) where the real pool runs into the
// hundreds per search. Lifted to 150 — high enough that the operator
// actually sees the diversity Brave + Unipile return, low enough that
// scoring + Hunter stay inside budget.
const DEFAULT_QUERY_COUNT = 10;                 // 5 LinkedIn + 5 Brave (50/50 split)
const SCORING_CONCURRENCY = 8;
const SEARCH_CONCURRENCY = 4;
const CANDIDATES_PER_QUERY = 25;                // LinkedIn — Unipile caps at 100, 25 gives variety without spamming
const BRAVE_CANDIDATES_PER_QUERY = 20;          // Brave — API max is 20 per request; exceeding it returns 422 Unprocessable Entity
const MAX_TOTAL_CANDIDATES = 150;               // lifted from 20 (which dated from the 60s wall-time era)
const SEARCH_TIMEOUT_MS = 15_000;               // per-search timeout — Unipile cold-tier searches can take ~10s
// HUNTER_AT_DISCOVERY_CAP / HUNTER_CONCURRENCY / HUNTER_TIMEOUT_MS removed
// 2026-05-19 — Hunter now runs inline per Brave candidate inside
// scoreAndUpsertCandidate, alongside the LLM scorer. There's no separate
// post-scoring loop to cap. Per-candidate Hunter timeout (8s) lives
// inside lookupHunterContactForBrave in src/lib/discovery/scorer.ts.

// Tier → Unipile network_distance integer-array filter, or undefined to omit.
// '1st' / '2nd' filter to specific degrees. 'cold' omits the filter entirely
// because LinkedIn's degree 3 means "exact 3rd-degree only" (not 3rd+), and
// most cold prospects are 4th+ or out-of-network. Without the filter Unipile
// returns anyone matching keywords regardless of degree — exactly what we
// want for cold tier.
const TIER_TO_LINKEDIN_DISTANCE: Record<NetworkTier, number[] | undefined> = {
  '1st': [1],
  '2nd': [2],
  'cold': undefined,
};

export async function POST(request: Request) {
  // Phase timing — added 2026-05-15 to make Vercel logs useful when batch
  // discovery hangs. Each phase logs elapsed ms from request start, so if
  // a future regression appears we can see immediately which phase is slow.
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const log = (phase: string, extra?: Record<string, unknown>) =>
    console.log(`[discover-batch] ${ms()}ms ${phase}${extra ? ' ' + JSON.stringify(extra) : ''}`);

  log('start');

  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  let { product_id, project_id, query_count, sources, network_tiers } = body as {
    product_id?: string;
    project_id?: string;
    query_count?: number;
    sources?: DiscoverSource[];
    network_tiers?: NetworkTier[];
  };
  // Default FALSE as of 2026-05-15 — Brave latency degraded ~3x and
  // per-candidate enrichment was pushing total wall time past Vercel's
  // 60s edge budget, causing "Failed to fetch" client-side. Callers can
  // explicitly opt in via { enrich_with_brave: true } when signal
  // quality matters more than batch speed. Previously default-true (see
  // commit 5d4443d) but had to revert when the latency regressed.
  const enrichWithBrave: boolean = body?.enrich_with_brave === true;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.organisation_id;

  // Pre-flight cap check — block the whole batch if Brave or LLM tokens are
  // already exhausted for this billing month. Each batch typically costs 6-12
  // Brave queries + 20-60 candidate scoring calls (~100-300k tokens), so
  // running it on an exhausted org would silently fail at the wrapper level.
  const braveCap = await checkCap(organisation_id, 'brave_query');
  if (!braveCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('brave_query', braveCap), { status: 429 });
  }
  const llmCap = await checkCap(organisation_id, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }
  const meterFor = { organisation_id, route: '/api/pipeline/discover-batch' };

  // Project takes precedence when both are provided. Each route below
  // resolves 'auto' / missing to the most-recent active row of its kind.
  // The five scoring/ICP fields (scoring_rubric + 4 ICP lists) live on
  // both products and projects post-migration 022, so the offering type
  // includes them and we pull them on the project branch too — otherwise
  // buildScoringPrompt throws "scoring_rubric is not set" even when the
  // operator generated a perfectly valid investor rubric.
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
    /** Migration 027 — the fine-grained funding scenario slug. Drives the discovery + scoring prompts. */
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
      return NextResponse.json({ error: 'No active project found' }, { status: 400 });
    }
    const { data: project } = await db
      .from('projects')
      .select('id, name, description, sponsor, project_type, funding_type, funding_target, geography, asset_class, core_mechanism, customer_outcomes, icp_company_size, icp_verticals, icp_buyer_title, icp_stage, exclusions, investment_thesis, scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases')
      .eq('id', project_id)
      .single();
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    offering = {
      ...project,
      one_sentence_description: null,
      // buildScoringPrompt uses product_pitch as the "You are a scoring
      // analyst for X" anchor. Map the project's investment_thesis (or
      // description as fallback) into that slot so the prompt has a
      // useful subject line.
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
      return NextResponse.json(
        { error: 'No active product or project found. Create one first.' },
        { status: 400 }
      );
    }
    const { data: product } = await db
      .from('products')
      .select('id, name, one_sentence_description, core_mechanism, customer_outcomes, icp_company_size, icp_verticals, icp_buyer_title, icp_stage, exclusions, product_pitch, scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases, asset_class, geography')
      .eq('id', product_id)
      .single();
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
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

  // Default sources: LinkedIn if a channel is connected, Brave otherwise.
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

  // Resolve tier list now (was previously computed below queryGen, but we
  // need it for the discovery_runs insert too).
  const tiers: NetworkTier[] = network_tiers && network_tiers.length > 0
    ? network_tiers
    : ['1st', '2nd', 'cold'];

  // Insert the discovery_runs row up front (migration 010). Gives every
  // downstream upsert a stable anchor for tracing "which run surfaced
  // this prospect?". Status starts as 'running'; finalised on success
  // or marked 'failed' on the early-return paths below.
  //
  // We generate the UUID client-side so run_code (derived from id) can be
  // set in the same INSERT — migration 010 has run_code NOT NULL.
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
      triggered_by: user!.id,
      sources,
      network_tiers: tiers,
      enrich_with_brave: enrichWithBrave,
      query_count: query_count || DEFAULT_QUERY_COUNT,
      status: 'running',
    });

  if (runInsertError) {
    log('run_insert_failed', { error: runInsertError.message });
    return NextResponse.json(
      { error: `Failed to record discovery run: ${runInsertError.message}` },
      { status: 500 },
    );
  }

  log('run_started', { run_id: runId, run_code: runCode });

  // Helper — marks the discovery_runs row with final state before any
  // early-return path. Safe to call multiple times; idempotent in effect.
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
      // Resolve funding_type slug → the canonical describe sentence so the
      // generator prompt can tell the LLM exactly what investor profile to
      // target. Missing / unknown slugs fall through as null — generator
      // degrades to project_type only.
      funding_type: offering.funding_type,
      funding_type_describe: offering.funding_type
        ? FUNDING_TYPE_BY_VALUE[offering.funding_type as FundingType]?.describe ?? null
        : null,
      funding_target: offering.funding_target,
      geography: offering.geography,
      asset_class: offering.asset_class,
      // Product-side prospect type. Mirrors funding_type on the project
      // side — the operator-picked slug from the ICP dropdown becomes a
      // TOP PRIORITY instruction at the top of the query-generator prompt.
      // Sourced from products.icp_partner_type (UI now constrains to
      // PRODUCT_PROSPECT_TYPE_OPTIONS via dropdown).
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
  });

  if (!queryGen.ok) {
    log('query_gen_failed', { error: queryGen.error });
    await finaliseRun('failed', { search_errors: [{ stage: 'query_gen', error: queryGen.error }] });
    return NextResponse.json({ error: `Query generation failed: ${queryGen.error}` }, { status: 502 });
  }
  log('query_gen_done', {
    linkedin_queries: queryGen.linkedin_queries.length,
    brave_queries: queryGen.brave_queries.length,
  });

  // Look up the Unipile account_id once if any LinkedIn-flavoured source is selected.
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

  // `tiers` was resolved above (so we could record it on the discovery_runs row).

  // Two distinct query sets — LinkedIn gets person-targeting queries, Brave
  // gets company/deal/news queries. Same engine search shapes that match each
  // platform's actual indexing strengths.
  const jobs: Array<{ query: string; source: DiscoverSource; tier: NetworkTier }> = [];
  for (const source of sources) {
    if (source === 'brave') {
      // Brave has no network concept — always tag results as 'cold'.
      for (const q of queryGen.brave_queries) {
        jobs.push({ query: q.query, source, tier: 'cold' });
      }
    } else {
      // LinkedIn / Sales Nav: one search per tier the operator wants to cover.
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

  // De-dup across queries by (linkedin_url || domain). Preference order:
  //   1. LinkedIn-sourced beats Brave-sourced (pre-attached contact data)
  //   2. Closer network tier beats further (1st > 2nd > cold)
  // Same person found in 1st-degree search dominates a cold-search hit so the
  // assign step picks the warm DM template.
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
    // Prefer LinkedIn-sourced over Brave.
    if (existing.source === 'brave' && (c.source === 'linkedin' || c.source === 'sales_nav')) {
      seen.set(key, c);
      continue;
    }
    // Among LinkedIn-sourced duplicates, prefer the closer network tier.
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

  const uniqueCandidates = Array.from(seen.values()).slice(0, MAX_TOTAL_CANDIDATES);

  log('searches_done', {
    candidates_found: allCandidates.length,
    candidates_unique: uniqueCandidates.length,
    search_errors: errors.length,
  });

  // Score everything in parallel batches.
  const offeringDescription = offering.description || offering.one_sentence_description || '';
  const projectMeta = offering.sponsor || offering.funding_target || offering.geography
    ? ` Sponsor: ${offering.sponsor || '—'}. Funding: ${offering.funding_target || '—'}. Geography: ${offering.geography || '—'}. Asset class: ${offering.asset_class || '—'}.`
    : '';
  const productContext = `Offering: ${offering.name}. ${offeringDescription}.${projectMeta} ICP: ${offering.icp_company_size || ''} firms in ${offering.icp_verticals || ''}, buyer: ${offering.icp_buyer_title || ''}.`;

  // Build the scoring system prompt once per batch (Phase C — multi-tenant
  // ICP). Uses the offering as ScoringPromptProduct since for product-driven
  // batches the offering IS the product (project-driven batches reuse the
  // project's underlying product columns). Funding type is resolved here so
  // the same describe sentence used by the query-generator filter also
  // appears in the scoring rubric — discovery and scoring stay aligned.
  let scoringSystemPrompt: string;
  try {
    // Pass through the full set of rich ICP fields the operator
    // configured on the product / project card. Pre-2026-05-18 the
    // scorer received only product_pitch + scoring_rubric + a few
    // icp_* arrays, and the operator-set buyer_title / verticals /
    // exclusions etc. were silently dropped — they appeared as soft
    // hints in the per-candidate productContext message but were not
    // hard-gating any score. That let articles' authors (journalists
    // at Business Insider, SmartCompany, Yale SOM) get rated 8+
    // because the article TOPIC matched the verticals while the
    // contact's actual job title clearly did not match the buyer
    // profile. See src/lib/pipeline/scoring-prompt.ts for the hard
    // gate logic those fields now drive.
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
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
        // Offering-aware default for partner_type. Operator-configured
        // icp_partner_type wins (so a project explicitly set to
        // 'referral' still wins). When unset, fall through to the
        // route's heuristic inside the scorer: project → 'lender',
        // product → 'buyer'.
        defaultPartnerType: offering.icp_partner_type ?? null,
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

  // Top-N by weighted score for the UI preview.
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

  // Tier breakdown — operator wants to know how many warm leads vs cold.
  const tierBreakdown: Record<NetworkTier, number> = { '1st': 0, '2nd': 0, 'cold': 0 };
  for (const r of scoredResults) {
    if (r.status !== 'error' && r.network_distance) {
      tierBreakdown[r.network_distance] = (tierBreakdown[r.network_distance] || 0) + 1;
    }
  }

  // Sample scoring errors so the UI can surface what's actually failing.
  // The per-candidate try/catch in scoreAndUpsertCandidate captures the
  // exception but the count alone has been masking the actual cause
  // (e.g. deprecated model id, OpenRouter quota, parse failure).
  const scoringErrorSamples = Array.from(
    new Set(
      scoredResults
        .filter(r => r.status === 'error' && r.error)
        .map(r => r.error as string),
    ),
  ).slice(0, 5);

  await db.from('audit_events').insert({
    organisation_id,
    actor: `user:${user!.id}`,
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

  // Flatten both sets for the UI — same shape as before but tagged by intended source.
  const queriesUsed = [
    ...queryGen.linkedin_queries.map(q => ({ query: q.query, rationale: q.rationale, category: q.expected_category, intended_source: 'linkedin' as const })),
    ...queryGen.brave_queries.map(q => ({ query: q.query, rationale: q.rationale, category: q.expected_category, intended_source: 'brave' as const })),
  ];

  const candidatesScored = scoredResults.filter(r => r.status !== 'error').length;
  const candidatesFailed = scoredResults.filter(r => r.status === 'error').length;

  // LinkedIn profile-only enrichment at discovery REMOVED (was costing ~10s
  // and pushed total wall time over the 60s edge ceiling). Operator can
  // trigger it any time via POST /api/admin/refresh-enrichment, and the
  // assign-batch flow runs full (profile+posts) enrichment automatically
  // when sequencing — that's when the rich data actually matters.
  const profileEnrichmentOutcomes: Array<{ status: string }> = [];

  // Hunter enrichment is now INLINE in scoreAndUpsertCandidate (parallel
  // with the LLM scorer). The separate post-scoring Hunter pass that
  // used to live here is gone — see src/lib/discovery/scorer.ts
  // lookupHunterContactForBrave + the parallel Promise.all wrapper.
  //
  // Benefits:
  //   - Every Brave candidate gets Hunter (was capped at top-30 by score).
  //   - DISCARD branch: Brave candidates where scorer says out_of_scope
  //     AND Hunter returns no email are dropped without persisting — no
  //     more dead-weight company shells polluting Prospects.
  //   - Wall time is roughly unchanged: scoring and Hunter happen in
  //     the same Promise.all per candidate (~max 8-10s), not in serial
  //     phases. The post-pass Hunter loop that used to consume ~25s of
  //     additional wall time is gone.
  //
  // Operator flagged 2026-05-19: 'why waste my space with Brave output
  // I can't contact?' — answered structurally rather than via UI filters.
  const hunterEnrichmentOutcomes: Array<{ partner_id: string; status: string; email?: string | null }> = [];
  const discardedCount = scoredResults.filter(r => r.status === 'discarded').length;

  log('done', {
    candidates_scored: candidatesScored,
    candidates_failed: candidatesFailed,
    candidates_discarded: discardedCount,
    profile_enriched: profileEnrichmentOutcomes.filter(o => o.status === 'partial' || o.status === 'success').length,
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

  return NextResponse.json({
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
  });
}

/**
 * Pick rows round-robin across LLM-scorer category buckets, capped at N.
 * Within each bucket rows are sorted by weighted_score descending. We
 * pop the top of each bucket in turn until the cap is reached.
 *
 * Why: top-N-globally stacked the enrichment budget on the offering's
 * flagship vertical when the scorer over-rewarded matches against the
 * flagship's named proof. Round-robin guarantees a spread across the
 * verticals the operator's ICP actually targets. The scorer-prompt
 * vertical-neutrality rule (added same commit) flattens the score
 * distribution; round-robin guarantees the distribution shows up in
 * the enriched set even if the scorer drifts.
 *
 * Rows without a category fall into a single 'uncategorised' bucket so
 * they still get a slot rather than being dropped silently.
 */
function roundRobinAcrossCategories<T extends { category?: string | null; weighted_score?: number | null }>(
  rows: T[],
  cap: number,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.category && /^out[_ ]?of[_ ]?scope$/i.test(row.category) ? '__excluded__' : (row.category || 'uncategorised');
    if (key === '__excluded__') continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }
  buckets.forEach(arr => {
    arr.sort((a: T, b: T) => (b.weighted_score || 0) - (a.weighted_score || 0));
  });
  const out: T[] = [];
  const bucketArrays = Array.from(buckets.values());
  let i = 0;
  while (out.length < cap && bucketArrays.some(b => b.length > 0)) {
    const bucket = bucketArrays[i % bucketArrays.length];
    if (bucket.length > 0) out.push(bucket.shift()!);
    i++;
  }
  return out;
}

/**
 * Wrap any promise with a hard timeout. Used per-search call so a hung Unipile
 * request can't block the entire batch's wall clock budget — a slow search
 * gets aborted and recorded as an error, the batch continues with the others.
 */
function withTimeout<T>(
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
  job: { query: string; source: DiscoverSource; tier: NetworkTier },
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

  // Brave — no network concept. Tag results as 'cold'. Use the higher
  // BRAVE_CANDIDATES_PER_QUERY since web search returns more diverse hits
  // and the per-result cost is lower than a LinkedIn API call.
  //
  // Publisher / journalism / academic domains get dropped here BEFORE
  // they reach scoring + Hunter enrichment. Without this, Brave queries
  // built from product ICP keywords routinely return articles ABOUT
  // companies in the verticals — and Hunter on the article-publisher
  // domain returns the article's AUTHOR (a journalist) rather than
  // anyone at the subject company. The scorer then rates the article
  // topic 8+ and the operator sees "Reporter at Business Insider"
  // listed as a top prospect. See src/lib/discovery/publisher-domains.ts
  // for the curated list + the reasoning.
  try {
    const searchResults = await braveWebSearch(job.query, BRAVE_CANDIDATES_PER_QUERY, undefined, meterFor);
    let droppedPublisher = 0;
    let droppedJunk = 0;
    const filtered = searchResults.filter(r => {
      // Publisher-domain check: WSJ / IBISWorld / similar journalism
      // sites. Hunter at those returns reporters, not the article's
      // subject company.
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
      // Junk-result check: listicles, ranking articles, question
      // pages, generic-page hits ("Company History", "About Us"),
      // editorial URL paths (/blog/, /case-studies/). Dropping these
      // pre-score saves the LLM + Hunter budget for actual companies.
      // Operator flagged 2026-05-19: 'scrabbling for 10 and 20 of
      // thousands of businesses that should match my ICP' — the
      // budget waste on guaranteed-junk results was the bottleneck,
      // not the candidate cap.
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

  // Company-name resolution priority:
  //   1. Unipile current_company (most reliable when present)
  //   2. Parse from headline — LinkedIn headlines usually follow patterns like
  //      "Title at Firm" / "Title - Firm" / "Title @ Firm". Extracted firm is
  //      truthier than falling back to the person's own name.
  //   3. Last resort: person's name (kept so the row isn't completely opaque,
  //      but the Prospects UI now knows to render this as a person-not-firm).
  // Prior version always fell through to person.full_name when current_company
  // was null, which caused the "Steve Mercieca shown as a Company" bug visible
  // on 2026-05-15 — 60+ LinkedIn-cold rows had their company set to the
  // person's name.
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

// extractCompanyFromHeadline moved to src/lib/discovery/headline.ts so the
// enrichment orchestrator and the migration's data backfill can share it.
