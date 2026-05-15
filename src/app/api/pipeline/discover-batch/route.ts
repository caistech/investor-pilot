/**
 * POST /api/pipeline/discover-batch
 *
 * The "Find investors for this product" engine.
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

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { braveWebSearch } from '@/lib/agent/brave-tools';
import {
  searchLinkedInPeople,
  searchSalesNavigator,
  type LinkedInPerson,
} from '@/lib/channels/unipile';
import { scoreAndUpsertCandidate, type ScoreCandidateInput } from '@/lib/discovery/scorer';
import { generateLenderQueries } from '@/lib/discovery/query-generator';

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
// edge gateway budget. Browsers were getting "Failed to fetch" because the
// function had no response bytes to send before the client connection dropped.
// New numbers target a ~30-40s wall time even with degraded externals.
const DEFAULT_QUERY_COUNT = 3;          // was 5 — cuts search calls by ~40%
const SCORING_CONCURRENCY = 8;
const SEARCH_CONCURRENCY = 4;
const CANDIDATES_PER_QUERY = 5;         // was 10 — fewer hits per query keeps the scoring budget tight
const MAX_TOTAL_CANDIDATES = 20;        // was 40 — halves scoring wall time
const SEARCH_TIMEOUT_MS = 12_000;       // per-search timeout — one stuck Unipile call can't kill the batch

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

  // Project takes precedence when both are provided. Each route below
  // resolves 'auto' / missing to the most-recent active row of its kind.
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
    funding_target: string | null;
    geography: string | null;
    asset_class: string | null;
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
      .select('id, name, description, sponsor, project_type, funding_target, geography, asset_class, core_mechanism, customer_outcomes, icp_company_size, icp_verticals, icp_buyer_title, icp_stage, exclusions')
      .eq('id', project_id)
      .single();
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    offering = { ...project, one_sentence_description: null };
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
      .select('id, name, one_sentence_description, core_mechanism, customer_outcomes, icp_company_size, icp_verticals, icp_buyer_title, icp_stage, exclusions')
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
      funding_target: offering.funding_target,
      geography: offering.geography,
      asset_class: offering.asset_class,
    },
    knowledgeBase: (kbSources || []).map(s => ({
      title: s.title,
      source_type: s.source_type,
      url: s.url,
      content: s.content,
    })),
    count: query_count || DEFAULT_QUERY_COUNT,
  });

  if (!queryGen.ok) {
    log('query_gen_failed', { error: queryGen.error });
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

  // Default tier order: 1st-degree priority, then 2nd, then cold.
  // For Brave (no network concept), 'cold' covers it.
  const tiers: NetworkTier[] = network_tiers && network_tiers.length > 0
    ? network_tiers
    : ['1st', '2nd', 'cold'];

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
      batch.map(j => withTimeout(fetchCandidates(j, linkedinAccountId), SEARCH_TIMEOUT_MS, j))
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

  const scoredResults: Awaited<ReturnType<typeof scoreAndUpsertCandidate>>[] = [];
  for (let i = 0; i < uniqueCandidates.length; i += SCORING_CONCURRENCY) {
    const batchStart = Date.now();
    const batch = uniqueCandidates.slice(i, i + SCORING_CONCURRENCY);
    const results = await Promise.all(
      batch.map(c => scoreAndUpsertCandidate(db, c, productContext, organisation_id, product_id || null, project_id || null, { enrichWithBrave }))
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

  log('done', {
    candidates_scored: scoredResults.filter(r => r.status !== 'error').length,
    candidates_failed: scoredResults.filter(r => r.status === 'error').length,
  });

  return NextResponse.json({
    ok: true,
    product_summary: queryGen.product_summary,
    queries_used: queriesUsed,
    sources_used: sources,
    network_tiers_used: tiers,
    tier_breakdown: tierBreakdown,
    candidates_found: allCandidates.length,
    candidates_unique: uniqueCandidates.length,
    candidates_scored: scoredResults.filter(r => r.status !== 'error').length,
    candidates_failed: scoredResults.filter(r => r.status === 'error').length,
    search_errors: errors,
    scoring_errors: scoringErrorSamples,
    top_results: topResults,
  });
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

  // Brave — no network concept. Tag results as 'cold'.
  try {
    const searchResults = await braveWebSearch(job.query, CANDIDATES_PER_QUERY);
    const candidates = searchResults.map(r => {
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

  return {
    name: person.current_company || person.full_name,
    domain,
    description,
    source,
    contact_name: person.full_name || undefined,
    contact_title: person.headline || undefined,
    contact_linkedin: person.profile_url || undefined,
    network_distance: tier,
  };
}
