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
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const returnUrl = `${appUrl}/dashboard/channels?connected=${provider}`;

  const link = await createHostedAuthLink({
    provider,
    organisation_id: profile.organisation_id,
    return_url: returnUrl,
  });

  if (!link) {
    return NextResponse.json({ error: 'Failed to create Unipile auth link. Check UNIPILE_API_KEY.' }, { status: 500 });
  }

  return NextResponse.json({ url: link.url, expires_at: link.expires_at });
}
