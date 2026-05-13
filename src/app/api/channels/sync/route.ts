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
    // Unipile's account objects vary in field naming. Try the common ones in
    // priority order and fall back to dumping the raw keys for diagnosis.
    const providerRaw = pickProvider(acct);

    const channelType = providerRaw ? mapProviderToChannelType(providerRaw) : null;
    if (!channelType) {
      skipped.push({
        account_id: acct.id,
        provider: providerRaw || `undefined (keys: ${Object.keys(acct).join(',')})`,
        reason: providerRaw
          ? `Provider ${providerRaw} not in our channel_type CHECK constraint (linkedin|email|calendar)`
          : `Could not determine provider — raw account: ${JSON.stringify(acct).slice(0, 400)}`,
      });
      continue;
    }

    const internalProvider = mapProviderToInternal(providerRaw);
    const identifier = pickIdentifier(acct);
    const isActive = isAccountActive(acct);

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

/**
 * Unipile account objects have inconsistent provider-field naming depending on
 * endpoint and version. Check the documented + observed fields in priority order:
 *   - type            (modern Unipile API)
 *   - provider        (what we assumed first)
 *   - account_type
 *   - sources[0].type (nested form sometimes used)
 */
function pickProvider(acct: Record<string, unknown>): string | null {
  if (typeof acct.type === 'string' && acct.type) return acct.type;
  if (typeof acct.provider === 'string' && acct.provider) return acct.provider;
  if (typeof acct.account_type === 'string' && acct.account_type) return acct.account_type;
  const sources = acct.sources as Array<{ type?: string }> | undefined;
  if (Array.isArray(sources) && sources[0]?.type) return sources[0].type;
  return null;
}

function pickIdentifier(acct: Record<string, unknown>): string {
  if (typeof acct.identifier === 'string' && acct.identifier) return acct.identifier;
  if (typeof acct.name === 'string' && acct.name) return acct.name;
  // LinkedIn-specific: connection_params.im.username
  const params = acct.connection_params as { im?: { username?: string }; mail?: { username?: string } } | undefined;
  if (params?.im?.username) return params.im.username;
  if (params?.mail?.username) return params.mail.username;
  return String(acct.id);
}

function isAccountActive(acct: Record<string, unknown>): boolean {
  const status = (acct.status as string | undefined)?.toUpperCase();
  if (status === 'OK') return true;
  if (status === 'CREDENTIALS' || status === 'DISCONNECTED' || status === 'STOPPED') return false;
  // Some Unipile responses use sources[].status
  const sources = acct.sources as Array<{ status?: string }> | undefined;
  if (Array.isArray(sources) && sources.length > 0) {
    return sources.every(s => (s.status || '').toUpperCase() === 'OK');
  }
  return true; // optimistic default when status is undefined
}

function mapProviderToChannelType(provider: string): 'linkedin' | 'email' | 'calendar' | null {
  const p = (provider || '').toUpperCase();
  if (p === 'LINKEDIN') return 'linkedin';
  if (p === 'GMAIL' || p === 'OUTLOOK' || p === 'MAIL' || p === 'GOOGLE' || p === 'MICROSOFT') return 'email';
  if (p === 'GOOGLE_CALENDAR' || p === 'MICROSOFT_CALENDAR') return 'calendar';
  // WHATSAPP / INSTAGRAM / TELEGRAM / MESSENGER / X / TIKTOK not in our schema yet
  return null;
}

function mapProviderToInternal(provider: string): 'unipile' | 'google' | 'microsoft' | 'resend' {
  const p = (provider || '').toUpperCase();
  if (p === 'GMAIL' || p === 'GOOGLE' || p === 'GOOGLE_CALENDAR') return 'google';
  if (p === 'OUTLOOK' || p === 'MICROSOFT' || p === 'MICROSOFT_CALENDAR') return 'microsoft';
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
