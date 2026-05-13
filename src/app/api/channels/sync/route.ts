/**
 * POST /api/channels/sync
 *
 * Manual fallback for the Unipile webhook. Lists all accounts connected
 * to the operator's Unipile workspace and upserts them into client_channels.
 * Useful when:
 *   - Accounts were connected directly in the Unipile dashboard (skipping our flow)
 *   - The hosted-auth notify webhook didn't reach us
 *   - We need to recover after a webhook outage
 *
 * Audit-logged.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { listAccounts, type UnipileAccountRaw } from '@/lib/channels/unipile';

export async function POST() {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const list = await listAccounts();
  if (!list.ok) {
    return NextResponse.json({ error: list.error }, { status: 502 });
  }

  const synced: Array<{ account_id: string; provider: string; identifier: string; action: string }> = [];
  const skipped: Array<{ account_id: string; provider: string; reason: string }> = [];

  for (const acct of list.accounts) {
    const channelType = mapProviderToChannelType(acct.provider);
    if (!channelType) {
      skipped.push({
        account_id: acct.id,
        provider: acct.provider,
        reason: `Provider ${acct.provider} not in our channel_type CHECK constraint (linkedin|email|calendar)`,
      });
      continue;
    }

    const internalProvider = mapProviderToInternal(acct.provider);
    const identifier = acct.identifier || acct.name || acct.id;
    const isActive = (acct.status || '').toUpperCase() === 'OK' || acct.status === undefined;

    const { error: upsertError } = await db
      .from('client_channels')
      .upsert(
        {
          organisation_id: profile.organisation_id,
          channel_type: channelType,
          provider: internalProvider,
          account_identifier: identifier,
          display_name: acct.name || null,
          oauth_token_ref: acct.id,
          status: isActive ? 'active' : 'flagged',
          warmup_day: 1,
          daily_send_cap: defaultCapForChannel(channelType),
          daily_send_count: 0,
        },
        { onConflict: 'organisation_id,channel_type,account_identifier' }
      );

    if (upsertError) {
      skipped.push({ account_id: acct.id, provider: acct.provider, reason: upsertError.message });
    } else {
      synced.push({
        account_id: acct.id,
        provider: acct.provider,
        identifier,
        action: 'upserted',
      });
    }
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'channel.sync_from_unipile',
    resource_type: 'organisation',
    resource_id: profile.organisation_id,
    payload: { synced_count: synced.length, skipped_count: skipped.length, synced, skipped },
  });

  return NextResponse.json({
    ok: true,
    synced_count: synced.length,
    skipped_count: skipped.length,
    synced,
    skipped,
  });
}

function mapProviderToChannelType(provider: string): 'linkedin' | 'email' | 'calendar' | null {
  const p = (provider || '').toUpperCase();
  if (p === 'LINKEDIN') return 'linkedin';
  if (p === 'GMAIL' || p === 'OUTLOOK' || p === 'MAIL') return 'email';
  if (p === 'GOOGLE_CALENDAR' || p === 'MICROSOFT_CALENDAR') return 'calendar';
  // WHATSAPP / INSTAGRAM / TELEGRAM / MESSENGER not in our schema yet
  return null;
}

function mapProviderToInternal(provider: string): 'unipile' | 'google' | 'microsoft' | 'resend' {
  const p = (provider || '').toUpperCase();
  if (p === 'GMAIL') return 'google';
  if (p === 'OUTLOOK') return 'microsoft';
  return 'unipile';
}

function defaultCapForChannel(channel_type: 'linkedin' | 'email' | 'calendar'): number {
  if (channel_type === 'linkedin') return 20;
  if (channel_type === 'email') return 50;
  return 0;
}

// Allow GET too — handy for one-shot manual sync from a browser.
export async function GET() {
  return POST();
}
