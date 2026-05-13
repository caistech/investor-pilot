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

export async function createHostedAuthLink(opts: {
  provider: 'linkedin' | 'gmail' | 'outlook';
  organisation_id: string;
  return_url: string;
}): Promise<{ url: string; expires_at: string } | null> {
  // Unipile provides hosted auth pages — we redirect the operator to a
  // signed URL and they complete OAuth on Unipile's domain. On success,
  // Unipile webhook fires and we receive the account_id to store.
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'X-API-Key': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'create',
        providers: [opts.provider.toUpperCase()],
        api_url: UNIPILE_BASE_URL,
        success_redirect_url: opts.return_url,
        failure_redirect_url: opts.return_url + '?error=oauth_failed',
        notify_url: process.env.NEXT_PUBLIC_APP_URL + '/api/webhooks/unipile/account',
        name: opts.organisation_id, // Unipile passes this back in the webhook
      }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return { url: json.url, expires_at: json.expires_at };
  } catch {
    return null;
  }
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
