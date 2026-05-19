/**
 * InvestorPilot adapter over `@caistech/apollo-people`.
 *
 * Resolves the API key from env (APOLLO_API_KEY) and layers project-specific
 * metering on top of the shared package. All API mechanics live in the hub —
 * this file only owns:
 *   - env-var resolution (dark-mode when unset)
 *   - per-call metering via logEvent (apollo_search / apollo_enrichment)
 *   - timeout via AbortSignal
 *
 * Dark-mode by default: if APOLLO_API_KEY is missing, both functions return
 * null/[] silently so the cascade in `email-finder.ts` falls through to
 * Hunter-only without erroring.
 */

import {
  apolloPeopleSearch as remoteApolloPeopleSearch,
  apolloPersonEnrichment as remoteApolloPersonEnrichment,
  type ApolloPersonSummary,
  type ApolloEnrichedPerson,
} from '@caistech/apollo-people';
import { logEvent } from '@/lib/usage/events';

export type { ApolloPersonSummary, ApolloEnrichedPerson };

export interface MeterFor {
  organisation_id: string;
  route: string;
}

const APOLLO_TIMEOUT_MS = 10_000;

function getApiKey(): string | null {
  const key = process.env.APOLLO_API_KEY;
  return key && key.trim().length > 0 ? key : null;
}

export function isApolloConfigured(): boolean {
  return getApiKey() !== null;
}

export async function apolloPeopleSearch(args: {
  domain: string;
  titles?: string[];
  seniorities?: string[];
  per_page?: number;
  page?: number;
  signal?: AbortSignal;
  meterFor?: MeterFor;
}): Promise<ApolloPersonSummary[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const signal = args.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS);

  try {
    const people = await remoteApolloPeopleSearch(
      {
        domain: args.domain,
        titles: args.titles,
        seniorities: args.seniorities,
        per_page: args.per_page,
        page: args.page,
        signal,
      },
      apiKey,
    );

    if (args.meterFor) {
      void logEvent(args.meterFor.organisation_id, 'apollo_search', 1, {
        route: args.meterFor.route,
        domain: args.domain.slice(0, 200),
        candidates_returned: people.length,
      });
    }

    return people;
  } catch (err) {
    console.warn('[apollo] search failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function apolloPersonEnrichment(args: {
  person_id?: string;
  first_name?: string;
  last_name?: string;
  domain?: string;
  email?: string;
  signal?: AbortSignal;
  meterFor?: MeterFor;
}): Promise<ApolloEnrichedPerson | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const signal = args.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS);

  try {
    const enriched = await remoteApolloPersonEnrichment(
      {
        person_id: args.person_id,
        first_name: args.first_name,
        last_name: args.last_name,
        domain: args.domain,
        email: args.email,
        signal,
      },
      apiKey,
    );

    // Credit-aware metering — Apollo charges 1 credit on a successful
    // email reveal; we log 0 for misses so the operator sees miss rates
    // distinctly from successful reveals.
    if (args.meterFor) {
      void logEvent(args.meterFor.organisation_id, 'apollo_enrichment', enriched?.email ? 1 : 0, {
        route: args.meterFor.route,
        domain: args.domain?.slice(0, 200),
        email_revealed: !!enriched?.email,
        email_status: enriched?.email_status,
      });
    }

    return enriched;
  } catch (err) {
    console.warn('[apollo] enrichment failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
