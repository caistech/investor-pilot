/**
 * InvestorPilot adapter over `@caistech/email-finder`.
 *
 * Resolves API keys from env (HUNTER_API_KEY + APOLLO_API_KEY), wires the
 * cascade's onProviderCall hook to InvestorPilot's logEvent metering, and
 * re-exports the FoundContact shape that scorer.ts depends on.
 *
 * All cascade mechanics (provider order, role-account fallthrough,
 * timeouts, credit accounting) live in the hub package. This file owns
 * only the env + metering glue.
 */

import {
  findContactByDomain as remoteFindContactByDomain,
  type FoundContact as RemoteFoundContact,
  type ProviderCallEvent,
} from '@caistech/email-finder';
import { logEvent } from '@/lib/usage/events';
import type { MeterFor } from '@/lib/agent/brave-tools';

export type FoundContact = RemoteFoundContact;

interface FindContactOptions {
  titles?: string[];
  seniorities?: string[];
  meterFor?: MeterFor;
  signal?: AbortSignal;
}

function getHunterKey(): string | null {
  const k = process.env.HUNTER_API_KEY;
  return k && k.trim().length > 0 ? k : null;
}

function getApolloKey(): string | null {
  const k = process.env.APOLLO_API_KEY;
  return k && k.trim().length > 0 ? k : null;
}

function buildMeterHook(meterFor: MeterFor | undefined) {
  if (!meterFor) return undefined;
  return (event: ProviderCallEvent) => {
    // Map provider call events to usage_events rows. Hunter calls log as
    // 'hunter_lookup'; Apollo search + enrichment log under their own
    // event types so caps can be set independently.
    const eventType =
      event.provider === 'hunter'
        ? 'hunter_lookup'
        : event.provider === 'apollo_search'
          ? 'apollo_search'
          : 'apollo_enrichment';
    // Credit-aware units: Apollo enrichment hits = 1 credit; misses/errors
    // log 0 so the operator sees miss rates without inflating spend.
    const units =
      event.provider === 'apollo_enrichment'
        ? event.credits_used ?? (event.outcome === 'hit' ? 1 : 0)
        : 1;
    void logEvent(meterFor.organisation_id, eventType, units, {
      route: meterFor.route,
      provider: event.provider,
      outcome: event.outcome,
      ms: event.ms,
      domain: event.domain.slice(0, 200),
    });
  };
}

/**
 * Find an actionable contact (name + email) for a domain. Drop-in wrapper
 * over the hub cascade — see `@caistech/email-finder` for behaviour.
 *
 * Returns null in two cases the caller should distinguish:
 *   1. HUNTER_API_KEY is unset (misconfigured project) — logged warn.
 *   2. Neither Hunter nor Apollo produced a contact at this domain.
 */
export async function findContactByDomain(
  domain: string,
  options: FindContactOptions = {},
): Promise<FoundContact | null> {
  const hunterKey = getHunterKey();
  if (!hunterKey) {
    console.warn('[email-finder] HUNTER_API_KEY not configured — cascade disabled');
    return null;
  }

  return remoteFindContactByDomain(
    domain,
    {
      hunter: hunterKey,
      apollo: getApolloKey() || undefined,
    },
    {
      titles: options.titles,
      seniorities: options.seniorities,
      signal: options.signal,
      onProviderCall: buildMeterHook(options.meterFor),
    },
  );
}
