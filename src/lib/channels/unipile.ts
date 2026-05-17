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

let cachedClient: UnipileClient | null = null;

function getClient(): UnipileClient {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) {
    throw new Error('UNIPILE_API_KEY env var is not set');
  }
  cachedClient = createUnipileClient({
    apiKey,
    baseUrl: process.env.UNIPILE_BASE_URL,
  });
  return cachedClient;
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
  // Preserve the precise env-error messages that the connect UI expects.
  if (!process.env.UNIPILE_API_KEY) {
    return { ok: false, error: 'UNIPILE_API_KEY env var is not set on the server' };
  }
  if (!process.env.UNIPILE_BASE_URL) {
    return {
      ok: false,
      error: 'UNIPILE_BASE_URL env var is not set. Each Unipile account has its own DSN (Data Source Name) URL — find yours in the Unipile dashboard (typically https://apiX.unipile.com:13XXX) and set UNIPILE_BASE_URL to that value in Vercel and locally.',
    };
  }
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL env var is not set — needed for webhook notify URL' };
  }

  // Encode org_id:user_id in the Unipile `name` field so the webhook can
  // assign the new channel to the right team member. Falls back to org-only
  // for legacy code paths that don't pass user_id.
  const name = opts.user_id
    ? `${opts.organisation_id}:${opts.user_id}`
    : opts.organisation_id;

  return getClient().createHostedAuthLink({
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
