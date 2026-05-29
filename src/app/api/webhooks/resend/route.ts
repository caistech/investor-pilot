/**
 * POST /api/webhooks/resend
 *
 * Resend webhook for delivery / bounce / complaint / delay events.
 *
 * Signature scheme: svix headers (svix-id, svix-timestamp, svix-signature)
 * verified against RESEND_WEBHOOK_SECRET. Rejects with 401 if invalid.
 *
 * Event handling:
 *   email.bounced       → mark outreach_log.status = 'bounced' (or
 *                          outbound_messages.send_error = 'bounced: <type>'),
 *                          partners.status = 'contact_partial',
 *                          clear partners.contact_email so enrich can re-run,
 *                          cancel any downstream queued sequence_steps
 *   email.complained    → same as bounced (spam complaint is harsher; treat the
 *                          contact as undeliverable)
 *   email.delivery_delayed → log warning, no state change
 *   email.delivered     → no-op (we already mark sent on the send response)
 *   email.sent          → no-op (we already mark sent on the send response)
 *   email.opened        → not tracked (would need a tracking_events table)
 *   email.clicked       → not tracked (would need a tracking_events table)
 *
 * Lookup strategy: each event carries data.email_id (Resend's message ID).
 * That ID is persisted in BOTH outreach_log.gmail_message_id (legacy
 * /api/pipeline/send path) and outbound_messages.channel_message_id
 * (sequencer path). We try outreach_log first, then outbound_messages.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Webhook } from 'svix';

interface ResendEventData {
  email_id?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
  created_at?: string;
  bounce?: { type?: string; subType?: string; message?: string };
  complaint?: { type?: string };
}

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: ResendEventData;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend webhook] RESEND_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 });
  }

  // svix needs the raw body string for signature verification — request.json()
  // would have re-serialized and broken the signature.
  const rawBody = await request.text();

  let event: ResendEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendEvent;
  } catch (err) {
    console.warn('[resend webhook] signature verification failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true, ignored: 'no email_id in event' });
  }

  switch (event.type) {
    case 'email.bounced':
    case 'email.complained':
      return handleUndeliverable(supabaseAdmin, emailId, event);
    case 'email.delivery_delayed':
      return handleDelayed(supabaseAdmin, emailId, event);
    case 'email.delivered':
    case 'email.sent':
    case 'email.opened':
    case 'email.clicked':
      return NextResponse.json({ ok: true, ignored: event.type });
    default:
      return NextResponse.json({ ok: true, ignored: event.type });
  }
}

async function handleUndeliverable(supabaseAdmin: any, emailId: string, event: ResendEvent) {
  const isComplaint = event.type === 'email.complained';
  const bounceType = event.data?.bounce?.type || event.data?.complaint?.type || event.type;
  const bounceMessage = event.data?.bounce?.message || null;
  const now = new Date().toISOString();

  // Try legacy outreach_log path first.
  const { data: outreachRow } = await supabaseAdmin
    .from('outreach_log')
    .select('id, partner_id, organisation_id, status')
    .eq('gmail_message_id', emailId)
    .maybeSingle();

  if (outreachRow) {
    // Idempotent: skip if already marked bounced.
    if (outreachRow.status !== 'bounced') {
      await supabaseAdmin
        .from('outreach_log')
        .update({ status: 'bounced', updated_at: now })
        .eq('id', outreachRow.id);
    }
    await applyPartnerBounceSideEffects(supabaseAdmin, outreachRow.partner_id, outreachRow.organisation_id, bounceType, bounceMessage, isComplaint, now);
    return NextResponse.json({ ok: true, matched: 'outreach_log', partner_id: outreachRow.partner_id });
  }

  // Try sequencer path.
  const { data: outboundRow } = await supabaseAdmin
    .from('outbound_messages')
    .select('id, partner_id, organisation_id, send_error')
    .eq('channel_message_id', emailId)
    .maybeSingle();

  if (outboundRow) {
    const errorLabel = `${isComplaint ? 'complained' : 'bounced'}: ${bounceType}${bounceMessage ? ` — ${bounceMessage}` : ''}`;
    if (outboundRow.send_error !== errorLabel) {
      await supabaseAdmin
        .from('outbound_messages')
        .update({ send_error: errorLabel })
        .eq('id', outboundRow.id);
    }
    if (outboundRow.partner_id) {
      await applyPartnerBounceSideEffects(supabaseAdmin, outboundRow.partner_id, outboundRow.organisation_id, bounceType, bounceMessage, isComplaint, now);
    }
    return NextResponse.json({ ok: true, matched: 'outbound_messages', partner_id: outboundRow.partner_id });
  }

  // Resend can deliver events for messages we never persisted (e.g. test
  // sends from the Resend dashboard). Acknowledge so Resend doesn't retry.
  console.warn('[resend webhook] no matching message for email_id', emailId, 'event', event.type);
  return NextResponse.json({ ok: true, ignored: 'no matching message' });
}

async function applyPartnerBounceSideEffects(
  supabaseAdmin: any,
  partnerId: string,
  organisationId: string,
  bounceType: string,
  bounceMessage: string | null,
  isComplaint: boolean,
  now: string,
) {
  // Mark partner as contact_partial and clear the bad email so the next
  // enrichment pass can try a fresh address.
  await supabaseAdmin
    .from('partners')
    .update({
      status: 'contact_partial',
      contact_email: null,
      last_updated_at: now,
    })
    .eq('id', partnerId);

  // Cancel any pending downstream sequence_steps — sending more to a
  // bounced address compounds the deliverability hit.
  await supabaseAdmin
    .from('sequence_steps')
    .update({ status: 'skipped', updated_at: now })
    .eq('partner_id', partnerId)
    .in('status', ['pending', 'awaiting_verification', 'queued_for_approval']);

  await supabaseAdmin.from('audit_events').insert({
    organisation_id: organisationId,
    actor: 'system:resend_webhook',
    action: isComplaint ? 'email.complained' : 'email.bounced',
    resource_type: 'partner',
    resource_id: partnerId,
    payload: { bounce_type: bounceType, message: bounceMessage },
  });
}

async function handleDelayed(supabaseAdmin: any, emailId: string, event: ResendEvent) {
  // No state change — Resend will retry. Log so the audit trail captures it.
  const { data: outreachRow } = await supabaseAdmin
    .from('outreach_log')
    .select('id, partner_id, organisation_id')
    .eq('gmail_message_id', emailId)
    .maybeSingle();

  const row = outreachRow || (await supabaseAdmin
    .from('outbound_messages')
    .select('id, partner_id, organisation_id')
    .eq('channel_message_id', emailId)
    .maybeSingle()).data;

  if (row?.organisation_id) {
    await supabaseAdmin.from('audit_events').insert({
      organisation_id: row.organisation_id,
      actor: 'system:resend_webhook',
      action: 'email.delivery_delayed',
      resource_type: 'partner',
      resource_id: row.partner_id,
      payload: { email_id: emailId, event_created_at: event.created_at },
    });
  }

  return NextResponse.json({ ok: true, matched: row ? 'logged' : 'unknown' });
}
