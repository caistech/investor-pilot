/**
 * Apollo.io REST API client.
 *
 * Two-step contact-finding pattern:
 *   1. apolloPeopleSearch — find candidate people at a domain matching
 *      ICP titles/seniorities. FREE — does not consume credits.
 *      Returns candidate metadata (id, name first-only + obfuscated last,
 *      title, has_email flag) but NOT the email itself.
 *   2. apolloPersonEnrichment — reveal a single person's email. Consumes
 *      1 credit per match. Called only on the best candidate from step 1.
 *
 * Dark-mode by default: if APOLLO_API_KEY env is missing, both functions
 * return null silently so callers can build a cascade (Hunter -> Apollo
 * -> null) that's safe to ship without the env var configured. When the
 * operator adds APOLLO_API_KEY on Vercel, the Apollo layer activates
 * with no further deploy needed.
 *
 * Operator decision 2026-05-19: Apollo as a cascade fallback after
 * Hunter. Hunter has thin AU SME coverage; Apollo's 270M-person
 * database covers global mid-market much better. The Search step
 * being free means we can browse candidates per domain without
 * burning the 185-credit monthly cap.
 *
 * Endpoint base: https://api.apollo.io/api/v1
 * Auth: X-Api-Key header (per the deprecation notice — URL params are
 * being deprecated as of late 2025).
 */

import { logEvent } from '@/lib/usage/events';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const APOLLO_TIMEOUT_MS = 10_000;

export interface MeterFor {
  organisation_id: string;
  route: string;
}

export interface ApolloPersonSummary {
  /** Apollo's internal person ID — pass to enrichment to reveal email. */
  id: string;
  first_name: string | null;
  last_name_obfuscated: string | null;
  title: string | null;
  has_email: boolean;
  organization_name: string | null;
  last_refreshed_at: string | null;
}

export interface ApolloEnrichedPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  /** Confidence in the email reveal: 'verified' / 'likely' / 'unavailable'. */
  email_status: string | null;
  linkedin_url: string | null;
  organization_name: string | null;
}

function getApiKey(): string | null {
  const key = process.env.APOLLO_API_KEY;
  return key && key.trim().length > 0 ? key : null;
}

export function isApolloConfigured(): boolean {
  return getApiKey() !== null;
}

interface ApolloSearchPersonRaw {
  id?: string;
  first_name?: string;
  last_name_obfuscated?: string;
  title?: string;
  has_email?: boolean;
  organization?: { name?: string };
  last_refreshed_at?: string;
}

interface ApolloEnrichmentPersonRaw {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  organization?: { name?: string };
}

async function apolloFetch(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = signal ? undefined : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), APOLLO_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${APOLLO_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
      signal: signal || controller?.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apollo ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * People API Search — find net-new people at a domain matching ICP.
 * FREE. Returns up to per_page candidates (default 5).
 *
 * Returns [] silently when APOLLO_API_KEY env is missing (dark mode).
 */
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

  const body: Record<string, unknown> = {
    q_organization_domains_list: [args.domain.replace(/^www\./, '').replace(/\/.*$/, '')],
    per_page: args.per_page || 5,
    page: args.page || 1,
  };
  if (args.titles?.length) body.person_titles = args.titles;
  if (args.seniorities?.length) body.person_seniorities = args.seniorities;

  try {
    const raw = await apolloFetch('/mixed_people/api_search', body, apiKey, args.signal);
    const parsed = raw as { people?: ApolloSearchPersonRaw[] };
    const people = (parsed.people || []).map((p): ApolloPersonSummary => ({
      id: p.id || '',
      first_name: p.first_name || null,
      last_name_obfuscated: p.last_name_obfuscated || null,
      title: p.title || null,
      has_email: !!p.has_email,
      organization_name: p.organization?.name || null,
      last_refreshed_at: p.last_refreshed_at || null,
    })).filter(p => p.id);

    // Metering — Search is free at Apollo but we still log the call so
    // the operator sees their cascade pattern in usage analytics.
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

/**
 * People Enrichment — reveal email for a single person. Costs 1 credit
 * per match. Apollo accepts EITHER person_id OR name+domain. We prefer
 * person_id when we have it (returns from a prior Search) for higher
 * match accuracy.
 *
 * Returns null silently when APOLLO_API_KEY is missing OR Apollo couldn't
 * match / reveal an email. Callers handle null as "Apollo had nothing".
 */
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

  const body: Record<string, unknown> = {
    reveal_personal_emails: false,
  };
  if (args.person_id) body.id = args.person_id;
  if (args.first_name) body.first_name = args.first_name;
  if (args.last_name) body.last_name = args.last_name;
  if (args.domain) body.domain = args.domain.replace(/^www\./, '').replace(/\/.*$/, '');
  if (args.email) body.email = args.email;

  try {
    const raw = await apolloFetch('/people/match', body, apiKey, args.signal);
    const parsed = raw as { person?: ApolloEnrichmentPersonRaw };
    const p = parsed.person;
    if (!p) return null;

    const enriched: ApolloEnrichedPerson = {
      id: p.id || '',
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      title: p.title || null,
      email: p.email || null,
      email_status: p.email_status || null,
      linkedin_url: p.linkedin_url || null,
      organization_name: p.organization?.name || null,
    };

    // Apollo charges credits on a SUCCESSFUL email reveal. We log the
    // call regardless so the operator sees miss rates too.
    if (args.meterFor) {
      void logEvent(args.meterFor.organisation_id, 'apollo_enrichment', enriched.email ? 1 : 0, {
        route: args.meterFor.route,
        domain: args.domain?.slice(0, 200),
        email_revealed: !!enriched.email,
        email_status: enriched.email_status,
      });
    }

    return enriched;
  } catch (err) {
    console.warn('[apollo] enrichment failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
