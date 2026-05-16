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
import { logEvent } from '@/lib/usage/events';
import type { MeterFor } from '@/lib/agent/brave-tools';

export type { HunterEmailResult, HunterDomainResult, HunterEmailVerifierResult };

function getApiKey(): string {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new Error('HUNTER_API_KEY not configured');
  return apiKey;
}

function meter(meterFor: MeterFor | undefined, lookup: 'finder' | 'domain' | 'verifier', domain?: string) {
  if (!meterFor) return;
  void logEvent(meterFor.organisation_id, 'hunter_lookup', 1, {
    route: meterFor.route,
    lookup,
    domain,
  });
}

export async function hunterEmailFinder(
  domain: string,
  firstName: string,
  lastName: string,
  meterFor?: MeterFor,
): Promise<HunterEmailResult | null> {
  const result = await remoteEmailFinder(domain, firstName, lastName, getApiKey());
  meter(meterFor, 'finder', domain);
  return result;
}

export async function hunterDomainSearch(
  domain: string,
  meterFor?: MeterFor,
): Promise<HunterDomainResult | null> {
  const result = await remoteDomainSearch(domain, getApiKey());
  meter(meterFor, 'domain', domain);
  return result;
}

export async function hunterEmailVerifier(
  email: string,
  meterFor?: MeterFor,
): Promise<HunterEmailVerifierResult | null> {
  const result = await remoteEmailVerifier(email, getApiKey());
  meter(meterFor, 'verifier');
  return result;
}
