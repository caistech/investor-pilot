/**
 * GET /api/cron/drain-send-queue
 *
 * Drains the `approved_queued_for_send` step queue at each channel's
 * daily-cap budget. Runs every 15 min via Vercel cron. Replaces the
 * inline-send path that used to live in /api/approvals/[id]/approve.
 *
 * Why: operator pre-approves messages once. The cron handles the
 * day-boundary cap reset and continues sending across days without
 * re-clicks. Channel-guard's cap_reset_at + warmup_day tracking already
 * model the daily roll-over; this cron just wraps them.
 *
 * Auth: CRON_SECRET header (Vercel cron) OR ?key=CRON_SECRET. The route
 * is allowlisted in middleware.ts.
 *
 * Per-tick behaviour:
 *   1. List all client_channels with status='active' across all orgs.
 *   2. For each channel, look up approved_queued_for_send steps where
 *      outbound_messages.client_channel_id matches.
 *   3. Process up to daily_remaining sends per channel (computed by
 *      checkChannelGuard — same logic the old inline path used).
 *   4. Each send dispatches via Unipile/Resend; success → status='sent',
 *      recordChannelSend increments daily_send_count + (eventually)
 *      advances warmup_day; failure → status='failed' with send_error
 *      surfaced in the approvals UI.
 *   5. Re-anchor future pending steps so their scheduled_for reflects
 *      actual send time (existing behaviour from the old route).
 *
 * Wall time discipline: each channel processes sequentially (LinkedIn
 * sends ~3-8s each; emails ~1-2s). The cron picks one channel at a time
 * to stay under Vercel's 60s ceiling. A backlog of >50 messages will
 * spread across multiple cron ticks — fine, the operator's daily caps
 * are typically ≤20-50 anyway.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { checkChannelGuard, recordChannelSend, type ChannelType } from '@/lib/channels/channel-guard';
import { sendLinkedInConnect, sendLinkedInDm, type SendResult } from '@/lib/channels/unipile';
import { sendEmail } from '@/lib/email/resend';

export const maxDuration = 60;

interface TemplateStep {
  step_index: number;
  delay_days: number;
  template_key: string;
}

export async function GET(request: Request) {
  // Auth — CRON_SECRET header (Vercel cron) OR ?key=. Same pattern as the
  // other cron endpoints in this repo.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(request.url);
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('key');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const startedAt = Date.now();
  const results = {
    channels_processed: 0,
    steps_sent: 0,
    steps_failed: 0,
    steps_skipped_cap: 0,
    errors: [] as Array<{ channel_id: string; error: string }>,
  };

  // Find every channel with at least one queued step. Skip channels with
  // an empty queue so we don't spend cron time on inactive accounts.
  const { data: channelsWithQueue } = await db
    .from('outbound_messages')
    .select('client_channel_id')
    .in(
      'sequence_step_id',
      // Subquery via raw filter — Supabase JS client doesn't support nested
      // queries directly, so we do a two-step lookup below.
      [],
    );

  // Two-step lookup: first list queued steps, group by client_channel_id.
  const { data: queuedSteps } = await db
    .from('sequence_steps')
    .select('id, organisation_id, outbound_message_id, channel, partner_id, template_id, step_index')
    .eq('status', 'approved_queued_for_send')
    .order('updated_at', { ascending: true }); // oldest-first FIFO

  if (!queuedSteps?.length) {
    return NextResponse.json({ ok: true, ...results, message: 'No steps queued for send' });
  }

  // Map step → channel_id via outbound_messages.
  const msgIds = queuedSteps.map(s => s.outbound_message_id).filter((id): id is string => !!id);
  const { data: msgs } = await db
    .from('outbound_messages')
    .select('id, client_channel_id')
    .in('id', msgIds);
  const channelByMsg = new Map((msgs || []).map(m => [m.id as string, m.client_channel_id as string | null]));

  // Group steps by channel for cap-aware processing.
  const stepsByChannel = new Map<string, typeof queuedSteps>();
  for (const step of queuedSteps) {
    const channelId = step.outbound_message_id ? channelByMsg.get(step.outbound_message_id) : null;
    if (!channelId) continue;
    const arr = stepsByChannel.get(channelId) || [];
    arr.push(step);
    stepsByChannel.set(channelId, arr);
  }

  // Process channels one at a time to stay under the 60s ceiling. Within a
  // channel, send sequentially because warmup-cap counting is stateful.
  for (const [channelId, steps] of Array.from(stepsByChannel.entries())) {
    if (Date.now() - startedAt > 50_000) break; // budget guard — finish this cron tick
    results.channels_processed += 1;
    for (const step of steps) {
      if (Date.now() - startedAt > 55_000) {
        results.steps_skipped_cap += 1;
        break;
      }
      const channelType = step.channel as ChannelType;
      const guard = await checkChannelGuard(db, channelId, channelType);
      if (!guard.allowed) {
        // Daily cap or warmup cap hit — skip; will retry next tick / next day.
        results.steps_skipped_cap += 1;
        continue;
      }
      const outcome = await dispatchStep(db, step, channelId);
      if (outcome.ok) {
        results.steps_sent += 1;
      } else {
        results.steps_failed += 1;
        results.errors.push({ channel_id: channelId, error: outcome.error });
      }
    }
  }

  const summary = { ok: true, ...results, wall_time_ms: Date.now() - startedAt };
  console.log(JSON.stringify({ src: 'cron:drain-send-queue', ...summary }));
  return NextResponse.json(summary);
}

async function dispatchStep(
  db: ReturnType<typeof createServiceClient>,
  step: {
    id: string;
    organisation_id: string;
    outbound_message_id: string | null;
    channel: string;
    partner_id: string;
    template_id: string;
    step_index: number;
  },
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!step.outbound_message_id) return { ok: false, error: 'no outbound_message_id' };

  const [{ data: msg }, { data: partner }, { data: template }, { data: channelRow }] = await Promise.all([
    db
      .from('outbound_messages')
      .select('id, channel, rendered_subject, rendered_body, approved_by')
      .eq('id', step.outbound_message_id)
      .single(),
    db
      .from('partners')
      .select('id, contact_email, contact_linkedin')
      .eq('id', step.partner_id)
      .single(),
    db
      .from('sequence_templates')
      .select('steps')
      .eq('id', step.template_id)
      .single(),
    db
      .from('client_channels')
      .select('oauth_token_ref')
      .eq('id', channelId)
      .single(),
  ]);

  if (!msg) return { ok: false, error: 'outbound_message missing' };
  if (!partner) return { ok: false, error: 'partner missing' };

  const channelType = msg.channel as ChannelType;
  let sendResult: SendResult;

  try {
    if (channelType === 'linkedin_connect') {
      if (!partner.contact_linkedin) return { ok: false, error: 'no contact_linkedin' };
      if (!channelRow?.oauth_token_ref) return { ok: false, error: 'channel missing Unipile account id' };
      sendResult = await sendLinkedInConnect({
        account_id: channelRow.oauth_token_ref as string,
        recipient_profile_url: partner.contact_linkedin as string,
        message: msg.rendered_body as string,
      });
    } else if (channelType === 'linkedin_dm') {
      if (!partner.contact_linkedin) return { ok: false, error: 'no contact_linkedin' };
      if (!channelRow?.oauth_token_ref) return { ok: false, error: 'channel missing Unipile account id' };
      sendResult = await sendLinkedInDm({
        account_id: channelRow.oauth_token_ref as string,
        recipient_profile_url: partner.contact_linkedin as string,
        body: msg.rendered_body as string,
      });
    } else if (channelType === 'email') {
      if (!partner.contact_email) return { ok: false, error: 'no contact_email' };
      if (!msg.rendered_subject) return { ok: false, error: 'no email subject' };
      const r = await sendEmail({
        to: partner.contact_email as string,
        subject: msg.rendered_subject as string,
        body: msg.rendered_body as string,
      });
      sendResult = r.id ? { ok: true, message_id: r.id } : { ok: false, error: r.error };
    } else {
      return { ok: false, error: `unknown channel: ${channelType}` };
    }
  } catch (err) {
    sendResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const nowIso = new Date().toISOString();

  if (!sendResult.ok) {
    await db.from('sequence_steps').update({ status: 'failed', executed_at: nowIso, updated_at: nowIso }).eq('id', step.id);
    await db.from('outbound_messages').update({ send_error: sendResult.error || 'unknown' }).eq('id', msg.id);
    await db.from('audit_events').insert({
      organisation_id: step.organisation_id,
      actor: 'cron:drain-send-queue',
      action: 'send.failed',
      resource_type: 'outbound_message',
      resource_id: msg.id,
      payload: {
        step_id: step.id,
        partner_id: step.partner_id,
        channel: channelType,
        error: sendResult.error,
        rate_limit_signal: sendResult.rate_limit_signal,
        account_health_signal: sendResult.account_health_signal,
      },
    });
    return { ok: false, error: sendResult.error || 'unknown' };
  }

  // Success — increment channel counter + advance step.
  await recordChannelSend(db, channelId);
  await db.from('sequence_steps').update({ status: 'sent', executed_at: nowIso, updated_at: nowIso }).eq('id', step.id);
  await db.from('outbound_messages').update({
    sent_at: nowIso,
    channel_message_id: sendResult.message_id || null,
  }).eq('id', msg.id);

  // Re-anchor downstream pending steps so their scheduled_for is relative
  // to actual send time, not the original assign time.
  await reanchorFutureSteps(db, {
    organisationId: step.organisation_id,
    partnerId: step.partner_id,
    templateId: step.template_id,
    sentStepIndex: step.step_index,
    sentAt: nowIso,
    templateSteps: (template?.steps as TemplateStep[]) || [],
  });

  await db.from('audit_events').insert({
    organisation_id: step.organisation_id,
    actor: 'cron:drain-send-queue',
    action: 'send.dispatched',
    resource_type: 'outbound_message',
    resource_id: msg.id,
    payload: {
      step_id: step.id,
      partner_id: step.partner_id,
      channel: channelType,
      channel_message_id: sendResult.message_id,
    },
  });

  return { ok: true };
}

async function reanchorFutureSteps(
  db: ReturnType<typeof createServiceClient>,
  args: {
    organisationId: string;
    partnerId: string;
    templateId: string;
    sentStepIndex: number;
    sentAt: string;
    templateSteps: TemplateStep[];
  },
) {
  const sentStepDef = args.templateSteps.find(s => s.step_index === args.sentStepIndex);
  if (!sentStepDef) return;
  const { data: pending } = await db
    .from('sequence_steps')
    .select('id, step_index')
    .eq('organisation_id', args.organisationId)
    .eq('partner_id', args.partnerId)
    .eq('template_id', args.templateId)
    .eq('status', 'pending')
    .gt('step_index', args.sentStepIndex);
  if (!pending?.length) return;
  const sentAtMs = new Date(args.sentAt).getTime();
  for (const p of pending) {
    const tplDef = args.templateSteps.find(s => s.step_index === p.step_index);
    if (!tplDef) continue;
    const deltaDays = tplDef.delay_days - sentStepDef.delay_days;
    if (deltaDays < 0) continue;
    const newScheduledFor = new Date(sentAtMs + deltaDays * 86400 * 1000).toISOString();
    await db.from('sequence_steps').update({ scheduled_for: newScheduledFor }).eq('id', p.id);
  }
}
