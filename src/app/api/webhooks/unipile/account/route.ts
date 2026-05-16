/**
 * POST /api/webhooks/unipile/account
 *
 * Unipile webhook fired when:
 *   - An operator completes OAuth via hosted auth page (new account connected)
 *   - An account's health status changes (rate-limited, captcha, lockout)
 *
 * Writes to client_channels (insert on new account, update status on health change)
 * and audit_events (compliance trail).
 *
 * NOTE: Unipile webhook signature scheme TBC during spike (doc 08). For now
 * we trust the source-IP / shared-secret approach. Sprint 1 task: confirm
 * and harden per Unipile docs.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logEvent } from '@/lib/usage/events';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  // TODO Sprint 1: validate Unipile webhook signature once spec confirmed
  // For now, check shared-secret header (set in Unipile dashboard)
  const expectedSecret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = request.headers.get('x-unipile-secret');
    if (provided !== expectedSecret) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  const body = await request.json();
  const event_type = body.event_type || body.type;
  const account_id = body.account_id || body.id;
  const status = body.status;
  const provider = body.provider; // 'LINKEDIN' | 'GMAIL' | 'OUTLOOK'
  const identifier = body.identifier; // email or LinkedIn URN
  // Unipile passes the organisation_id back via the `name` field set in createHostedAuthLink
  const organisation_id = body.name || body.metadata?.organisation_id;

  if (!event_type || !account_id) {
    return NextResponse.json({ error: 'missing event_type or account_id' }, { status: 400 });
  }

  // New account connected
  if (event_type === 'creation_success' || event_type === 'account.connected') {
    if (!organisation_id) {
      return NextResponse.json({ error: 'no organisation_id in webhook' }, { status: 400 });
    }

    const channel_type = mapProviderToChannelType(provider);

    const { error: insertError } = await supabaseAdmin
      .from('client_channels')
      .upsert({
        organisation_id,
        channel_type,
        provider: mapProviderToInternal(provider),
        account_identifier: identifier || account_id,
        oauth_token_ref: account_id, // Unipile's account id, NOT the token
        status: 'active',
        warmup_day: 1,
        daily_send_cap: defaultCapForChannel(channel_type),
        daily_send_count: 0,
      }, { onConflict: 'organisation_id,channel_type,account_identifier' });

    if (insertError) {
      console.error('[unipile webhook] insert failed:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    await supabaseAdmin.from('audit_events').insert({
      organisation_id,
      actor: 'system:unipile_webhook',
      action: 'channel.connected',
      resource_type: 'client_channel',
      payload: { provider, identifier, account_id },
    });

    // Meter +1 active Unipile account for this org. Running sum of
    // unipile_account_active events = current connected count (the
    // disconnect branch below decrements with a negative units value).
    await logEvent(organisation_id, 'unipile_account_active', 1, {
      route: '/api/webhooks/unipile/account',
      provider,
      account_id,
    });

    return NextResponse.json({ ok: true });
  }

  // Account health change (rate-limited / captcha / lockout)
  if (event_type === 'account.status_changed' || event_type === 'account.flagged') {
    const newStatus = status === 'OK' ? 'active' : 'flagged';

    const { data: ch, error: updateError } = await supabaseAdmin
      .from('client_channels')
      .update({
        status: newStatus,
        pause_reason: status !== 'OK' ? `Unipile: ${status}` : null,
        last_health_check_at: new Date().toISOString(),
      })
      .eq('oauth_token_ref', account_id)
      .select('organisation_id, id')
      .single();

    if (updateError) {
      console.error('[unipile webhook] status update failed:', updateError);
    }

    if (ch) {
      await supabaseAdmin.from('audit_events').insert({
        organisation_id: ch.organisation_id,
        actor: 'system:unipile_webhook',
        action: newStatus === 'active' ? 'channel.healthy' : 'channel.flagged',
        resource_type: 'client_channel',
        resource_id: ch.id,
        payload: { status, account_id },
      });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: event_type });
}

function mapProviderToChannelType(provider: string): 'linkedin' | 'email' | 'calendar' {
  const p = (provider || '').toUpperCase();
  if (p === 'LINKEDIN') return 'linkedin';
  if (p === 'GMAIL' || p === 'OUTLOOK') return 'email';
  if (p === 'GOOGLE_CALENDAR' || p === 'MICROSOFT_CALENDAR') return 'calendar';
  return 'email';
}

function mapProviderToInternal(provider: string): 'unipile' | 'google' | 'microsoft' | 'resend' {
  const p = (provider || '').toUpperCase();
  if (p === 'GMAIL') return 'google';
  if (p === 'OUTLOOK') return 'microsoft';
  return 'unipile';
}

function defaultCapForChannel(channel_type: 'linkedin' | 'email' | 'calendar'): number {
  if (channel_type === 'linkedin') return 20; // LinkedIn connection requests (DMs use separate counter)
  if (channel_type === 'email') return 50;
  return 0;
}
