/**
 * InvestorPilot adapter over `@caistech/hunter-email`.
 *
 * Resolves the API key from env and preserves the existing call signatures so
 * downstream callers (enrich/discover-batch routes, agent tools) are unchanged.
 */

import {
  hunterEmailFinder as remoteEmailFinder,
  hunterDomainSearch as remoteDomainSearch,
  hunterEmailVerifier as remoteEmailVerifier,
  type HunterEmailResult,
  type HunterDomainResult,
  type HunterEmailVerifierResult,
} from '@caistech/hunter-email';

export type { HunterEmailResult, HunterDomainResult, HunterEmailVerifierResult };

function getApiKey(): string {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new Error('HUNTER_API_KEY not configured');
  return apiKey;
}

export async function hunterEmailFinder(
  domain: string,
  firstName: string,
  lastName: string,
): Promise<HunterEmailResult | null> {
  return remoteEmailFinder(domain, firstName, lastName, getApiKey());
}

export async function hunterDomainSearch(
  domain: string,
): Promise<HunterDomainResult | null> {
  return remoteDomainSearch(domain, getApiKey());
}

export async function hunterEmailVerifier(
  email: string,
): Promise<HunterEmailVerifierResult | null> {
  return remoteEmailVerifier(email, getApiKey());
}
