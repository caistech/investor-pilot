/**
 * InvestorPilot adapter over `@caistech/brave-search`.
 *
 * Resolves the API key from env (BRAVE_SEARCH_API_KEY or BRAVE_API_KEY) and
 * applies the project's default country (AU). All other behaviour is delegated
 * to the shared package.
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
): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY not configured');

  const results = await remoteBraveWebSearch(query, apiKey, {
    count,
    country: 'AU',
    signal,
  });

  // Fire-and-forget metering — one event per actual API call. We log even
  // when the result is empty because Brave still bills for the query.
  if (meterFor) {
    void logEvent(meterFor.organisation_id, 'brave_query', 1, {
      route: meterFor.route,
      query: query.slice(0, 200),
    });
  }

  return results;
}
