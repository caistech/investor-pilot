/**
 * Unipile channel wrapper (audience-agnostic).
 *
 * Provides typed functions to send LinkedIn connection requests, LinkedIn DMs,
 * and emails (via Gmail / Outlook OAuth) through Unipile's unified API.
 *
 * Audience-agnostic: this layer doesn't know if the recipient is a lender (v3)
 * or an advisor (v2). The audience is captured in the message body content
 * passed in; this wrapper just delivers it.
 *
 * Reference: docs/sprint-0/03-unipile-research.md
 * API docs: https://developer.unipile.com/docs
 *
 * NOTE: This implementation uses `fetch` directly rather than `@unipile/node-sdk`
 * to avoid adding a new npm dependency until the Unipile spike (doc 08) is
 * completed by Dennis. Once the spike commits, swap fetch for the SDK.
 */

const UNIPILE_BASE_URL = process.env.UNIPILE_BASE_URL || 'https://api.unipile.com';
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || '';

if (!UNIPILE_API_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[unipile] UNIPILE_API_KEY not set — channel sends will fail');
}

// =============================================================================
// Types
// =============================================================================

export interface UnipileAccount {
  account_id: string; // Unipile's internal account id (oauth_token_ref in DB)
  provider: 'linkedin' | 'gmail' | 'outlook';
  identifier: string; // LinkedIn URN or email address
  status: 'active' | 'paused' | 'flagged' | 'revoked';
}

export interface LinkedInConnectInput {
  account_id: string;
  recipient_profile_url: string;
  message: string; // 300 char max per LinkedIn limit
}

export interface LinkedInDmInput {
  account_id: string;
  recipient_profile_url: string;
  body: string;
}

export interface EmailSendInput {
  account_id: string; // Unipile Gmail/Outlook account
  to: string;
  subject: string;
  body_text: string;
  body_html?: string;
}

export interface SendResult {
  ok: boolean;
  message_id?: string;
  error?: string;
  rate_limit_signal?: boolean;
  account_health_signal?: 'captcha' | 'login_challenge' | 'lockout' | null;
}

// =============================================================================
// Send functions
// =============================================================================

export async function sendLinkedInConnect(input: LinkedInConnectInput): Promise<SendResult> {
  if (input.message.length > 300) {
    return { ok: false, error: 'LinkedIn connection note exceeds 300-char limit' };
  }

  // TODO Sprint 1: confirm exact Unipile endpoint via spike (doc 08 task 3.1)
  // Likely: POST /api/v1/users/invite or /api/v1/chats with type=invitation
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/users/invite`, {
      method: 'POST',
      headers: {
        'X-API-Key': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: input.account_id,
        provider_id: input.recipient_profile_url,
        message: input.message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return parseUnipileError(response.status, error);
    }

    const json = await response.json();
    return { ok: true, message_id: json.invitation_id || json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendLinkedInDm(input: LinkedInDmInput): Promise<SendResult> {
  // TODO Sprint 1: confirm via spike (doc 08 task 3.3)
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/chats/messages`, {
      method: 'POST',
      headers: {
        'X-API-Key': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: input.account_id,
        recipient: input.recipient_profile_url,
        text: input.body,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return parseUnipileError(response.status, error);
    }

    const json = await response.json();
    return { ok: true, message_id: json.message_id || json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendUnipileEmail(input: EmailSendInput): Promise<SendResult> {
  // For Phase 1, email may continue to go through Resend (already wired) rather
  // than Unipile. This stub is reserved for the case where Unipile-mediated
  // email send is preferred for unified inbox/webhook handling.
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/emails`, {
      method: 'POST',
      headers: {
        'X-API-Key': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: input.account_id,
        to: [{ address: input.to }],
        subject: input.subject,
        body: input.body_text,
        html_body: input.body_html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return parseUnipileError(response.status, error);
    }

    const json = await response.json();
    return { ok: true, message_id: json.message_id || json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// Account / health
// =============================================================================

export interface UnipileAccountRaw {
  id: string;
  provider: string; // LINKEDIN | GMAIL | OUTLOOK | WHATSAPP | etc.
  identifier?: string;
  name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export async function listAccounts(): Promise<{ ok: true; accounts: UnipileAccountRaw[] } | { ok: false; error: string }> {
  if (!UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };

  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/accounts`, {
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        'accept': 'application/json',
      },
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `Unipile ${response.status}: ${text.slice(0, 300)}` };
    }
    let parsed: { items?: UnipileAccountRaw[]; accounts?: UnipileAccountRaw[] } | UnipileAccountRaw[];
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `Non-JSON response: ${text.slice(0, 200)}` };
    }
    const accounts = Array.isArray(parsed)
      ? parsed
      : (parsed.items || parsed.accounts || []);
    return { ok: true, accounts };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/fetch error: ${detail}` };
  }
}

export async function getAccountStatus(account_id: string): Promise<UnipileAccount | null> {
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/accounts/${account_id}`, {
      headers: { 'X-API-Key': UNIPILE_API_KEY },
    });
    if (!response.ok) return null;
    const json = await response.json();
    return {
      account_id: json.id,
      provider: json.provider,
      identifier: json.identifier,
      status: json.status === 'OK' ? 'active' : 'flagged',
    };
  } catch {
    return null;
  }
}

export async function pauseAccount(account_id: string): Promise<boolean> {
  // TODO Sprint 1: confirm via spike (doc 08 task 3.8)
  // Unipile may not have a direct pause endpoint; the operator-level pause
  // is enforced in our middleware (channel-guard) by checking
  // client_channels.status before any send.
  return true;
}

// =============================================================================
// OAuth — Unipile-hosted connect flow
// =============================================================================

export type CreateHostedAuthLinkResult =
  | { ok: true; url: string; expires_at: string }
  | { ok: false; error: string };

export async function createHostedAuthLink(opts: {
  provider: 'linkedin' | 'gmail' | 'outlook';
  organisation_id: string;
  return_url: string;
}): Promise<CreateHostedAuthLinkResult> {
  if (!UNIPILE_API_KEY) {
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

  // Unipile hosted auth wizard expects expiresOn — give it 24h.
  const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const body = {
    type: 'create',
    providers: [opts.provider.toUpperCase()],
    api_url: UNIPILE_BASE_URL,
    expiresOn,
    success_redirect_url: opts.return_url,
    failure_redirect_url: opts.return_url + '?error=oauth_failed',
    notify_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/unipile/account`,
    name: opts.organisation_id, // Unipile passes this back in the webhook
  };

  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      // Surface Unipile's actual error so we can debug.
      console.error('[unipile.createHostedAuthLink] %d: %s', response.status, text);
      return {
        ok: false,
        error: `Unipile ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
      };
    }

    let json: { url?: string; expires_at?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: `Unipile returned non-JSON: ${text.slice(0, 200)}` };
    }

    if (!json.url) {
      return { ok: false, error: `Unipile responded 200 but no url field: ${JSON.stringify(json).slice(0, 200)}` };
    }
    return { ok: true, url: json.url, expires_at: json.expires_at || '' };
  } catch (err) {
    // Node 18+ fetch wraps real errors as TypeError("fetch failed") with the
    // actual cause attached. Unwrap chain so we see DNS / connection / TLS
    // details instead of the opaque "fetch failed".
    const detail = formatFetchError(err);
    console.error('[unipile.createHostedAuthLink] %s — URL: %s', detail, `${UNIPILE_BASE_URL}/api/v1/hosted/accounts/link`);
    return { ok: false, error: `Network/fetch error calling ${UNIPILE_BASE_URL}: ${detail}` };
  }
}

function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause: unknown = (err as Error & { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 4) {
    if (cause instanceof Error) {
      const c = cause as Error & { code?: string; errno?: number; hostname?: string };
      const bits = [c.message];
      if (c.code) bits.push(`code=${c.code}`);
      if (c.hostname) bits.push(`host=${c.hostname}`);
      parts.push(bits.join(' '));
      cause = c.cause;
    } else {
      parts.push(String(cause));
      cause = undefined;
    }
    depth += 1;
  }
  return parts.join(' ← ');
}

// =============================================================================
// LinkedIn search (people + Sales Navigator)
//
// This is the PRIMARY discovery engine for InvestorPilot per the
// Affluent Connections methodology: find prospects on LinkedIn / Sales
// Navigator via the operator's own connected account, score them with
// Claude, then send connection requests + DMs from the same account.
//
// Brave web search is a SUPPLEMENT for company-level signals
// (news, prior deal participation) where the operator can't surface
// people directly on LinkedIn.
//
// Endpoint shapes here are based on Unipile's published API docs and
// observed account behaviour as of 2026-05-13. Exact request/response
// fields need spike validation (doc 08 tests 3.11-3.13) before relying
// on this in production.
// =============================================================================

export interface LinkedInPerson {
  public_id: string;            // LinkedIn profile public id (e.g. "james-wilson-1234")
  profile_url: string;          // Full profile URL — used as recipient_profile_url on send
  full_name: string;
  headline: string | null;      // Profile headline / current role one-liner
  location: string | null;
  current_company: string | null;
  current_company_url: string | null;
  current_company_domain: string | null;
  industry: string | null;
  raw: Record<string, unknown>; // Original Unipile payload for fields we don't normalise
}

export interface LinkedInSearchFilters {
  keywords?: string;
  title?: string;
  location?: string;
  current_company?: string;
  industry?: string;
  limit?: number; // default 25, max 100
  // LinkedIn network-distance filter:
  //   'F' = 1st-degree (direct connection — DM, no connect request needed)
  //   'S' = 2nd-degree (mutual connection visible — warm cold)
  //   'O' = out-of-network / 3rd+ (truly cold)
  // When omitted, LinkedIn returns hits across all degrees.
  network_distance?: 'F' | 'S' | 'O';
}

export type LinkedInSearchResult =
  | { ok: true; people: LinkedInPerson[]; total?: number; next_cursor?: string | null }
  | { ok: false; error: string; rate_limit_signal?: boolean };

/**
 * Free-text LinkedIn people search via the operator's connected account.
 *
 * Acts as the account does, including respecting its visibility tier (1st/2nd
 * degree connections weighted higher). Subject to LinkedIn's daily search cap
 * — the channel-guard middleware does NOT currently rate-limit search; if the
 * spike (doc 08 test 3.13) reveals a hard cap, gate this call before issuing.
 *
 * TODO Sprint 1: confirm exact endpoint and response shape via spike (doc 08
 * task 3.11). Likely: POST /api/v1/linkedin/search with body
 * { account_id, keywords, filters }. Response includes paginated results with
 * profile public_id, name, headline, current_company.
 */
export async function searchLinkedInPeople(input: {
  account_id: string;
  filters: LinkedInSearchFilters;
}): Promise<LinkedInSearchResult> {
  if (!UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };

  try {
    // Unipile expects account_id as a URL query parameter, not in the body.
    // Validated by spike test 3.11 (doc 08) on 2026-05-13 — request with
    // account_id in body returns 400 with schema title "AccountIdParam"
    // and schema path "/account_id".
    const url = new URL(`${UNIPILE_BASE_URL}/api/v1/linkedin/search`);
    url.searchParams.set('account_id', input.account_id);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        api: 'classic', // 'classic' (free) | 'sales_navigator'
        category: 'people',
        keywords: input.filters.keywords || '',
        // Unipile maps these onto LinkedIn's filter UI parameters.
        keywords_title: input.filters.title,
        location: input.filters.location,
        current_company: input.filters.current_company,
        industry: input.filters.industry,
        // network_distance: F=first, S=second, O=other/out-of-network
        network_distance: input.filters.network_distance,
        limit: Math.min(input.filters.limit || 25, 100),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      if (response.status === 429) {
        return { ok: false, error: `Rate limited: ${text.slice(0, 300)}`, rate_limit_signal: true };
      }
      return { ok: false, error: `Unipile ${response.status}: ${text.slice(0, 300)}` };
    }

    return parseLinkedInSearchResponse(text);
  } catch (err) {
    return { ok: false, error: `Network/fetch error: ${formatFetchError(err)}` };
  }
}

/**
 * Sales Navigator search — richer filters (seniority, function, years in
 * position, premium intent signals). Requires the connected LinkedIn account
 * to have an active Sales Navigator subscription.
 *
 * TODO Sprint 1: confirm endpoint via spike (doc 08 task 3.12).
 */
export async function searchSalesNavigator(input: {
  account_id: string;
  filters: LinkedInSearchFilters & {
    seniority?: string[];
    function?: string[];
    years_in_position?: string;
  };
}): Promise<LinkedInSearchResult> {
  if (!UNIPILE_API_KEY) return { ok: false, error: 'UNIPILE_API_KEY not set' };
  if (!process.env.UNIPILE_BASE_URL) return { ok: false, error: 'UNIPILE_BASE_URL not set' };

  try {
    // Same as searchLinkedInPeople — account_id as query param, not body.
    const url = new URL(`${UNIPILE_BASE_URL}/api/v1/linkedin/search`);
    url.searchParams.set('account_id', input.account_id);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        api: 'sales_navigator',
        category: 'people',
        keywords: input.filters.keywords || '',
        keywords_title: input.filters.title,
        location: input.filters.location,
        current_company: input.filters.current_company,
        industry: input.filters.industry,
        seniority: input.filters.seniority,
        function: input.filters.function,
        years_in_position: input.filters.years_in_position,
        network_distance: input.filters.network_distance,
        limit: Math.min(input.filters.limit || 25, 100),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      if (response.status === 403 && /sales[_ -]?nav/i.test(text)) {
        return { ok: false, error: 'Connected LinkedIn account has no active Sales Navigator subscription' };
      }
      if (response.status === 429) {
        return { ok: false, error: `Rate limited: ${text.slice(0, 300)}`, rate_limit_signal: true };
      }
      return { ok: false, error: `Unipile ${response.status}: ${text.slice(0, 300)}` };
    }

    return parseLinkedInSearchResponse(text);
  } catch (err) {
    return { ok: false, error: `Network/fetch error: ${formatFetchError(err)}` };
  }
}

function parseLinkedInSearchResponse(text: string): LinkedInSearchResult {
  let parsed: { items?: unknown[]; data?: unknown[]; results?: unknown[]; total?: number; cursor?: string | null };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `Non-JSON Unipile response: ${text.slice(0, 200)}` };
  }
  const rawItems = (parsed.items || parsed.data || parsed.results || []) as Array<Record<string, unknown>>;
  const people: LinkedInPerson[] = rawItems.map(p => normaliseLinkedInPerson(p));
  return {
    ok: true,
    people,
    total: parsed.total,
    next_cursor: parsed.cursor ?? null,
  };
}

function normaliseLinkedInPerson(p: Record<string, unknown>): LinkedInPerson {
  // Unipile / LinkedIn response shape varies. Pull the common fields safely.
  const public_id =
    pickString(p, 'public_id') ||
    pickString(p, 'public_identifier') ||
    pickString(p, 'id') ||
    '';

  const profile_url =
    pickString(p, 'public_profile_url') ||
    pickString(p, 'profile_url') ||
    (public_id ? `https://www.linkedin.com/in/${public_id}` : '');

  const full_name =
    pickString(p, 'name') ||
    pickString(p, 'full_name') ||
    [pickString(p, 'first_name'), pickString(p, 'last_name')].filter(Boolean).join(' ').trim();

  const currentCompanyObj =
    (p.current_company as Record<string, unknown> | undefined) ||
    (Array.isArray(p.experiences) ? (p.experiences[0] as Record<string, unknown>) : undefined);

  const current_company = currentCompanyObj ? pickString(currentCompanyObj, 'name') : null;
  const current_company_url = currentCompanyObj ? pickString(currentCompanyObj, 'url') : null;
  const current_company_domain = currentCompanyObj ? pickString(currentCompanyObj, 'website') : null;

  return {
    public_id,
    profile_url,
    full_name,
    headline: pickString(p, 'headline') || pickString(p, 'title'),
    location: pickString(p, 'location') || pickString(p, 'location_name'),
    current_company,
    current_company_url,
    current_company_domain,
    industry: pickString(p, 'industry'),
    raw: p,
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

// =============================================================================
// Internals
// =============================================================================

function parseUnipileError(status: number, body: string): SendResult {
  // 429 = rate limit (Unipile-level or LinkedIn-level)
  if (status === 429) {
    return { ok: false, error: `Rate limited: ${body}`, rate_limit_signal: true };
  }

  // 403 sometimes indicates LinkedIn captcha or login challenge
  if (status === 403) {
    if (/captcha/i.test(body)) {
      return { ok: false, error: 'LinkedIn captcha challenge', account_health_signal: 'captcha' };
    }
    if (/login|auth/i.test(body)) {
      return { ok: false, error: 'LinkedIn login challenge', account_health_signal: 'login_challenge' };
    }
    return { ok: false, error: `Forbidden: ${body}`, account_health_signal: 'lockout' };
  }

  return { ok: false, error: `Unipile error ${status}: ${body}` };
}
