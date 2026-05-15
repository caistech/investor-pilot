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

export type { BraveSearchResult };

export async function braveWebSearch(
  query: string,
  count = 10,
  signal?: AbortSignal,
): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY not configured');

  return remoteBraveWebSearch(query, apiKey, {
    count,
    country: 'AU',
    signal,
  });
}
