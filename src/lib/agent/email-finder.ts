/**
 * Contact email finder cascade — Hunter first, Apollo on miss.
 *
 * Brave-sourced candidates need name + email to be actionable (see the
 * Prospects contract: company + name + email or the row is discarded).
 * Hunter's coverage is patchy for AU SMEs and weak globally outside
 * tech/SaaS verticals. Apollo's 270M-person DB fills those gaps —
 * specifically the AU SME / EMEA mid-market / Asia ranges where Hunter
 * returns role-only addresses (admin@, info@) or nothing.
 *
 * Cascade order:
 *   1. Hunter domain search → best-confidence email
 *   2. If Hunter returns null OR returns email without a real name
 *      (role-only addresses like admin@ / info@) → try Apollo
 *   3. Apollo two-step:
 *      a. apolloPeopleSearch (FREE) — find ICP-matching candidates at
 *         the domain. Filter to has_email=true.
 *      b. apolloPersonEnrichment (1 credit) — reveal the best
 *         candidate's email.
 *
 * Dark-mode safe: if APOLLO_API_KEY is unset, the Apollo cascade silently
 * skips and the function returns Hunter's result (or null) unchanged.
 * Adding the env var on Vercel turns the cascade on with no code change.
 *
 * Shape of return value matches the legacy Hunter-only return so scorer.ts
 * is a drop-in swap.
 */

import { hunterDomainSearch } from '@/lib/agent/hunter-tools';
import {
  apolloPeopleSearch,
  apolloPersonEnrichment,
  isApolloConfigured,
} from '@/lib/agent/apollo-tools';
import type { MeterFor } from '@/lib/agent/brave-tools';

export interface FoundContact {
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string;
  contact_linkedin: string | null;
  email_confidence: number;
  /** Which provider revealed this contact. Logged for cascade analytics. */
  source: 'hunter' | 'apollo';
}

interface FindContactOptions {
  /** ICP titles to bias Apollo's People Search (e.g. ["CEO","Director"]). */
  titles?: string[];
  /** ICP seniorities for Apollo's People Search (e.g. ["c_suite","director"]). */
  seniorities?: string[];
  /** Optional metering hook — fires per provider call. */
  meterFor?: MeterFor;
  /** Abort signal for the whole cascade. */
  signal?: AbortSignal;
}

/**
 * Role-account detector. Hunter sometimes returns the highest-confidence
 * email at a domain as admin@ / info@ / hello@ / contact@ etc. — generic
 * inbox addresses with no real person attached. These score high on
 * Hunter's deliverability check (the inbox exists) but are useless for
 * personalised outreach. Treat them as a Hunter miss and fall through to
 * Apollo.
 */
const ROLE_ACCOUNT_PREFIXES = new Set([
  'admin', 'info', 'hello', 'contact', 'support', 'help', 'sales',
  'enquiries', 'inquiries', 'office', 'mail', 'team', 'general',
  'reception', 'hr', 'careers', 'jobs', 'media', 'press',
]);

function isRoleAccount(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.split('@')[0]?.toLowerCase().trim() || '';
  return ROLE_ACCOUNT_PREFIXES.has(local);
}

async function tryHunter(
  domain: string,
  meterFor?: MeterFor,
): Promise<FoundContact | null> {
  try {
    const result = await Promise.race([
      hunterDomainSearch(domain, meterFor),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('hunter timeout')), 8_000),
      ),
    ]);
    if (!result?.emails?.length) return null;
    const sorted = [...result.emails].sort((a, b) => b.confidence - a.confidence);
    const best = sorted[0];
    if (!best?.value) return null;
    return {
      contact_name: [best.first_name, best.last_name].filter(Boolean).join(' ') || null,
      contact_title: best.position || null,
      contact_email: best.value,
      contact_linkedin: best.linkedin || null,
      email_confidence: best.confidence,
      source: 'hunter',
    };
  } catch {
    return null;
  }
}

async function tryApollo(
  domain: string,
  options: FindContactOptions,
): Promise<FoundContact | null> {
  if (!isApolloConfigured()) return null;

  try {
    const candidates = await apolloPeopleSearch({
      domain,
      titles: options.titles,
      seniorities: options.seniorities,
      per_page: 5,
      signal: options.signal,
      meterFor: options.meterFor,
    });

    // Prefer candidates Apollo says have an email available; without it,
    // enrichment is likely to come back unrevealed and we waste a credit.
    const withEmail = candidates.filter(c => c.has_email);
    const pool = withEmail.length > 0 ? withEmail : candidates;
    const best = pool[0];
    if (!best?.id) return null;

    const enriched = await apolloPersonEnrichment({
      person_id: best.id,
      domain,
      signal: options.signal,
      meterFor: options.meterFor,
    });
    if (!enriched?.email) return null;

    // Apollo email_status is a string ('verified' | 'likely' | etc.); map
    // to a numeric confidence that lines up with Hunter's 0-100 scale so
    // downstream code (scorer.ts) can treat both providers uniformly.
    const apolloConfidence = enriched.email_status === 'verified'
      ? 85
      : enriched.email_status === 'likely'
        ? 65
        : 50;

    return {
      contact_name: enriched.name
        || [enriched.first_name, enriched.last_name].filter(Boolean).join(' ')
        || null,
      contact_title: enriched.title || null,
      contact_email: enriched.email,
      contact_linkedin: enriched.linkedin_url || null,
      email_confidence: apolloConfidence,
      source: 'apollo',
    };
  } catch (err) {
    console.warn('[email-finder] apollo cascade failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Find an actionable contact (name + email) for a domain. Returns null if
 * neither Hunter nor Apollo can produce a person-attached email.
 *
 * Contract for callers:
 *   - A Hunter hit with a real name short-circuits the cascade (no Apollo
 *     credit consumed).
 *   - A Hunter hit with a role-only email (admin@, info@) is treated as
 *     a miss — Apollo is tried.
 *   - When Apollo is not configured (env var unset), this is equivalent
 *     to Hunter-only behaviour.
 */
export async function findContactByDomain(
  domain: string,
  options: FindContactOptions = {},
): Promise<FoundContact | null> {
  const hunter = await tryHunter(domain, options.meterFor);
  if (hunter && hunter.contact_name && !isRoleAccount(hunter.contact_email)) {
    return hunter;
  }

  const apollo = await tryApollo(domain, options);
  if (apollo) return apollo;

  // Apollo didn't fire (dark mode) or didn't find anyone — fall back to
  // whatever Hunter gave us (even if it's a role address). Caller decides
  // whether to discard based on contact_name.
  return hunter;
}
