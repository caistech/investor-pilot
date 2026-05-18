/**
 * InvestorPilot adapter over `@caistech/unipile-channels`.
 *
 * Resolves credentials and project-specific URL conventions (notify_url) at
 * the project boundary so call sites can keep their existing function-style
 * signatures unchanged.
 */

import {
  createUnipileClient,
  extractLinkedInProviderId as remoteExtractLinkedInProviderId,
  type UnipileClient,
  type LinkedInConnectInput,
  type LinkedInDmInput,
  type EmailSendInput,
  type SendResult,
  type UnipileAccount,
  type UnipileAccountRaw,
  type LinkedInPerson,
  type LinkedInSearchFilters,
  type LinkedInSearchResult,
  type SalesNavigatorFilters,
  type LinkedInProfile,
  type LinkedInPost,
  type LinkedInProfileResult,
  type LinkedInPostsResult,
  type ListAccountsResult,
  type CreateHostedAuthLinkResult,
} from '@caistech/unipile-channels';
import { createServiceClient } from '@/lib/supabase/server';

export type {
  LinkedInConnectInput,
  LinkedInDmInput,
  EmailSendInput,
  SendResult,
  UnipileAccount,
  UnipileAccountRaw,
  LinkedInPerson,
  LinkedInSearchFilters,
  LinkedInSearchResult,
  SalesNavigatorFilters,
  LinkedInProfile,
  LinkedInPost,
  LinkedInProfileResult,
  LinkedInPostsResult,
  CreateHostedAuthLinkResult,
};

// Module-load-time warning preserved from the prior implementation so a missing
// key surfaces in the Vercel logs rather than silently 401-ing on first send.
if (!process.env.UNIPILE_API_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[unipile] UNIPILE_API_KEY not set — channel sends will fail');
}

// BYOK: per-org Unipile credentials live in organisations.unipile_api_key.
// resolveUnipileCredentials(orgId) returns the org's key when set (agency
// tier), otherwise falls back to the platform-wide env var. Clients are
// cached per apiKey so we don't reinstantiate on every request, but the
// cache is keyed on the resolved key (not the org id), so the platform
// shared key is one cached client and each BYOK org is its own.
const clientCache = new Map<string, UnipileClient>();

/**
 * Normalise the Unipile base URL so a missing protocol can't silently
 * break searches. The shared @caistech/unipile-channels package builds
 * request URLs via `new URL(`${baseUrl}/api/v1/...`)` — if baseUrl is
 * `api44.unipile.com:17412` (no scheme), URL parses `api44.unipile.com:`
 * as the *protocol* and fetch sends to a garbled address. No exception
 * is thrown; the search just returns empty. We hit this 2026-05-18:
 * UNIPILE_BASE_URL stored without `https://` on Vercel + .env.local,
 * every LinkedIn search returned 0 results with zero error logs.
 * Normalise here so future env-config slips fail loudly OR are silently
 * corrected, not silently broken.
 */
function normaliseUnipileBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function resolveUnipileCredentials(orgId?: string): Promise<{
  apiKey: string | null;
  baseUrl: string | undefined;
  source: 'org' | 'env' | 'none';
}> {
  const baseUrl = normaliseUnipileBaseUrl(process.env.UNIPILE_BASE_URL);
  if (orgId) {
    const admin = createServiceClient();
    const { data: org } = await admin
      .from('organisations')
      .select('unipile_api_key')
      .eq('id', orgId)
      .maybeSingle();
    if (org?.unipile_api_key) {
      return {
        apiKey: org.unipile_api_key,
        baseUrl,
        source: 'org',
      };
    }
  }
  const envKey = process.env.UNIPILE_API_KEY ?? null;
  return {
    apiKey: envKey,
    baseUrl,
    source: envKey ? 'env' : 'none',
  };
}

function clientFor(apiKey: string, baseUrl: string | undefined): UnipileClient {
  const cacheKey = `${apiKey}|${baseUrl ?? ''}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;
  const client = createUnipileClient({ apiKey, baseUrl });
  clientCache.set(cacheKey, client);
  return client;
}

function getClient(): UnipileClient {
  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) {
    throw new Error('UNIPILE_API_KEY env var is not set');
  }
  return clientFor(apiKey, normaliseUnipileBaseUrl(process.env.UNIPILE_BASE_URL));
}

/**
 * Org-scoped Unipile client. Used by routes that have an org context
 * (most do, via authenticateAndGetDb). When the org has its own key set,
 * this returns a client wired to that key; otherwise falls back to the
 * platform shared key. Throws if neither is set.
 */
export async function getClientForOrg(orgId: string): Promise<UnipileClient> {
  const { apiKey, baseUrl, source } = await resolveUnipileCredentials(orgId);
  if (!apiKey) {
    throw new Error(`No Unipile credentials available — set per-org key in /settings/integrations (source=${source})`);
  }
  return clientFor(apiKey, baseUrl);
}

// =============================================================================
// Send
// =============================================================================

export async function sendLinkedInConnect(input: LinkedInConnectInput): Promise<SendResult> {
  return getClient().sendLinkedInConnect(input);
}

export async function sendLinkedInDm(input: LinkedInDmInput): Promise<SendResult> {
  return getClient().sendLinkedInDm(input);
}

// =============================================================================
// Account
// =============================================================================

export async function listAccounts(): Promise<ListAccountsResult> {
  // Preserve the prior behaviour of explicit env checks before touching Unipile,
  // so the operator UI shows precise "X env var not set" errors.
  if (!process.env.UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };
  return getClient().listAccounts();
}

export async function getAccountStatus(account_id: string): Promise<UnipileAccount | null> {
  return getClient().getAccountStatus(account_id);
}

// =============================================================================
// Hosted auth
// =============================================================================

export async function createHostedAuthLink(opts: {
  provider: 'linkedin' | 'gmail' | 'outlook';
  organisation_id: string;
  /** Migration 028 — which team member is connecting their own LinkedIn /
   *  email. Encoded into the Unipile `name` field and parsed back in the
   *  /api/webhooks/unipile/account handler so the new client_channels row
   *  lands with the right user_id. Optional for legacy single-user orgs. */
  user_id?: string;
  return_url: string;
}): Promise<CreateHostedAuthLinkResult> {
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL env var is not set — needed for webhook notify URL' };
  }

  // BYOK: resolve per-org Unipile credentials. If the org has its own key
  // (set via /settings/integrations), the hosted auth link is generated in
  // their tenant — the new account lands directly in their Unipile
  // workspace and they bear the cost / risk in isolation.
  const { apiKey, baseUrl, source } = await resolveUnipileCredentials(opts.organisation_id);
  if (!apiKey) {
    return { ok: false, error: 'No Unipile credentials available — set your org\'s key in /settings/integrations' };
  }
  if (!baseUrl) {
    return {
      ok: false,
      error: 'UNIPILE_BASE_URL env var is not set. Each Unipile account has its own DSN (Data Source Name) URL — find yours in the Unipile dashboard (typically https://apiX.unipile.com:13XXX) and set UNIPILE_BASE_URL to that value in Vercel and locally.',
    };
  }

  // Encode org_id:user_id in the Unipile `name` field so the webhook can
  // assign the new channel to the right team member. Falls back to org-only
  // for legacy code paths that don't pass user_id.
  const name = opts.user_id
    ? `${opts.organisation_id}:${opts.user_id}`
    : opts.organisation_id;

  const client = clientFor(apiKey, baseUrl);
  void source;
  return client.createHostedAuthLink({
    provider: opts.provider,
    name,
    return_url: opts.return_url,
    notify_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/unipile/account`,
  });
}

// =============================================================================
// Search
// =============================================================================

export async function searchLinkedInPeople(input: {
  account_id: string;
  filters: LinkedInSearchFilters;
}): Promise<LinkedInSearchResult> {
  if (!process.env.UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };
  return getClient().searchLinkedInPeople(input);
}

export async function searchSalesNavigator(input: {
  account_id: string;
  filters: SalesNavigatorFilters;
}): Promise<LinkedInSearchResult> {
  if (!process.env.UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };
  return getClient().searchSalesNavigator(input);
}

// =============================================================================
// Profile + posts
// =============================================================================

export async function getLinkedInProfile(input: {
  account_id: string;
  provider_id: string;
}): Promise<LinkedInProfileResult> {
  if (!process.env.UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };
  return getClient().getLinkedInProfile(input);
}

export async function getLinkedInPosts(input: {
  account_id: string;
  provider_id: string;
  limit?: number;
}): Promise<LinkedInPostsResult> {
  if (!process.env.UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };
  return getClient().getLinkedInPosts(input);
}

// =============================================================================
// Standalone utility
// =============================================================================

export const extractLinkedInProviderId = remoteExtractLinkedInProviderId;
