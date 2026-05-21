/**
 * POST /api/auth/unipile/connect
 *
 * Initiates Unipile-hosted OAuth flow for LinkedIn / Gmail / Outlook.
 * Returns a signed redirect URL to Unipile's hosted auth page. The operator
 * completes OAuth on Unipile's domain; on success, Unipile fires a webhook
 * to /api/webhooks/unipile/account with the new account_id.
 *
 * Audience-agnostic. Used for both Sprint 1 lender-channel outreach (v3) and
 * any future channel additions.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { createHostedAuthLink } from '@/lib/channels/unipile';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json();
  const { provider } = body as { provider: 'linkedin' | 'gmail' | 'outlook' };

  if (!['linkedin', 'gmail', 'outlook'].includes(provider)) {
    return NextResponse.json({ error: 'provider must be linkedin | gmail | outlook' }, { status: 400 });
  }

  // Resolve organisation
  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Pre-flight cap check — refuse to generate a connect link if the org has
  // already hit its connected-account limit. Avoids the user going through
  // Unipile's OAuth flow only to be silently rejected at the webhook.
  const cap = await checkCap(profile.active_organisation_id, 'unipile_account_active');
  if (!cap.allowed) {
    return NextResponse.json(buildCapExceededResponse('unipile_account_active', cap), { status: 429 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  // /channels lives in the (dashboard) route group — the group name is not
  // in the URL path, so the public URL is /channels, not /dashboard/channels.
  const returnUrl = `${appUrl}/channels?connected=${provider}`;

  const link = await createHostedAuthLink({
    provider,
    organisation_id: profile.active_organisation_id,
    user_id: user!.id,
    return_url: returnUrl,
  });

  if (!link.ok) {
    // Pass the actual Unipile error through so the operator can diagnose
    // (wrong DSN, expired token, missing env var, etc).
    return NextResponse.json({ error: link.error }, { status: 502 });
  }

  return NextResponse.json({ url: link.url, expires_at: link.expires_at });
}
