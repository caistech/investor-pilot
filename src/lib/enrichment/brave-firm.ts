/**
 * Brave firm-enrichment for a single partner.
 *
 * Used when partner.source = 'brave' (no LinkedIn URL to deep-read) and as
 * an optional supplement for LinkedIn-sourced partners that need richer
 * firm-level context. Runs two targeted Brave queries in parallel:
 *
 *   1. Recent news / deals — last ~12 months of activity
 *   2. Named deals / facility participation — credit-signal evidence
 *
 * Result lands in partners.firm_recent_news + partners.firm_named_deals.
 * Each call is wrapped in an 8s AbortSignal so a slow Brave response can't
 * block the assign-batch wall time (Brave latency degraded ~3x earlier
 * today — guarding against repeat).
 *
 * Quota note: each enrichment is 2 Brave calls. The free tier is 2k/month
 * and discovery already burns ~3-5 calls per Find Investors run. Caller
 * should gate on (a) partner.source = 'brave' OR opt-in flag and (b) the
 * partner not yet enriched.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { braveWebSearch } from '@/lib/agent/brave-tools';
import type { EnrichmentResult } from './linkedin-profile';

interface BraveItem {
  title: string;
  url: string;
  snippet: string;
}

export async function enrichPartnerFromBrave(
  db: SupabaseClient,
  partner: { id: string; company_name: string; contact_name: string | null },
): Promise<EnrichmentResult> {
  const company = partner.company_name?.trim();
  if (!company || company.length < 3) {
    await db.from('partners').update({
      evidence_enriched_at: new Date().toISOString(),
      evidence_enrichment_status: 'unavailable',
      evidence_enrichment_source: 'brave',
    }).eq('id', partner.id);
    return {
      status: 'unavailable',
      message: 'Company name too short for Brave query',
      profile_fetched: false,
      posts_fetched_count: 0,
      email_backfilled: false,
    };
  }

  // Bias both queries toward the v3 lender ICP signals — recent property /
  // credit / debt activity. Going broader is tempting but burns quota
  // surfacing irrelevant results.
  const currentYear = new Date().getUTCFullYear();
  const previousYear = currentYear - 1;
  const newsQuery = `"${company}" ${previousYear} OR ${currentYear} (property OR real estate) (deal OR facility OR loan OR fund OR investment)`;
  const dealsQuery = `"${company}" (senior debt OR first mortgage OR LVR OR private credit OR construction finance)`;

  const [newsResult, dealsResult] = await Promise.allSettled([
    braveWebSearch(newsQuery, 4, AbortSignal.timeout(8000)),
    braveWebSearch(dealsQuery, 4, AbortSignal.timeout(8000)),
  ]);

  const newsItems = extractItems(newsResult);
  const dealsItems = extractItems(dealsResult);

  const newsOk = newsResult.status === 'fulfilled';
  const dealsOk = dealsResult.status === 'fulfilled';

  if (!newsOk && !dealsOk) {
    await db.from('partners').update({
      evidence_enriched_at: new Date().toISOString(),
      evidence_enrichment_status: 'failed',
      evidence_enrichment_source: 'brave',
    }).eq('id', partner.id);
    return {
      status: 'failed',
      message: 'Both Brave queries failed (timeout or rate limit)',
      profile_fetched: false,
      posts_fetched_count: 0,
      email_backfilled: false,
    };
  }

  const status: 'success' | 'partial' | 'unavailable' =
    (newsOk && dealsOk && (newsItems.length + dealsItems.length) > 0)
      ? 'success'
      : (newsItems.length + dealsItems.length) > 0
        ? 'partial'
        : 'unavailable';

  await db.from('partners').update({
    firm_recent_news: newsItems,
    firm_named_deals: dealsItems,
    evidence_enriched_at: new Date().toISOString(),
    evidence_enrichment_status: status,
    evidence_enrichment_source: 'brave',
  }).eq('id', partner.id);

  return {
    status,
    profile_fetched: false,
    posts_fetched_count: 0,
    email_backfilled: false,
  };
}

function extractItems(
  result: PromiseSettledResult<Array<{ title: string; url: string; description: string }>>,
): BraveItem[] {
  if (result.status !== 'fulfilled') return [];
  return result.value.slice(0, 3).map(r => ({
    title: r.title.slice(0, 200),
    url: r.url,
    snippet: r.description.slice(0, 300),
  }));
}
