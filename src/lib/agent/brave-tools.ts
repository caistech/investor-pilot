/**
 * InvestorPilot adapter over `@caistech/brave-search`.
 *
 * Resolves the API key from env (BRAVE_SEARCH_API_KEY or BRAVE_API_KEY) and
 * applies the project's default country (US). All other behaviour is delegated
 * to the shared package.
 *
 * 2026-05-21: flipped default country AU → US alongside the US-primary
 * discovery pivot. AU coverage in Hunter+Apollo is poor, and the query
 * generator now biases queries to US markets — Brave's country lock was
 * the silent factor over-riding all of that by returning AU-skewed pages
 * regardless of the query string. Operator's services can be sold anywhere
 * so default fishing waters are the US, not AU.
 */

import {
  braveWebSearch as remoteBraveWebSearch,
  type BraveSearchResult,
} from '@caistech/brave-search';
import { logEvent } from '@/lib/usage/events';

export type { BraveSearchResult };

export interface MeterFor {
  organisation_id: string;
  route: string;
}

export async function braveWebSearch(
  query: string,
  count = 10,
  signal?: AbortSignal,
  meterFor?: MeterFor,
  offset = 0,
): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY not configured');

  // Brave's offset is 0-9 (representing pages 1-10 with count=20). Clamp
  // so a stale large offset doesn't 422 the request.
  const clampedOffset = Math.max(0, Math.min(9, Math.floor(offset)));

  const results = await remoteBraveWebSearch(query, apiKey, {
    count,
    country: 'US',
    signal,
    offset: clampedOffset,
  } as Parameters<typeof remoteBraveWebSearch>[2] & { offset: number });

  // Fire-and-forget metering — one event per actual API call. We log even
  // when the result is empty because Brave still bills for the query.
  if (meterFor) {
    void logEvent(meterFor.organisation_id, 'brave_query', 1, {
      route: meterFor.route,
      query: query.slice(0, 200),
      offset: clampedOffset,
    });
  }

  return results;
}
