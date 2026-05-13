/**
 * POST /api/approvals/[id]/approve
 *
 * Operator approval: dispatch the rendered message via Unipile (LinkedIn) or
 * Resend (email), then re-anchor future steps in the same sequence so timings
 * remain relative to actual send, not original assignment.
 *
 * Inline send is intentional for Sprint 1:
 *   - operator gets immediate "sent" / "failed" feedback in the approval queue
 *   - no async drain worker to debug
 *   - acceptable up to ~5/min, which is well above lender-channel volume
 *
 * Sends pass through channel-guard (kill switch, daily cap, warmup) which is
 * the only thing between us and a LinkedIn ban — see channel-guard.ts.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkChannelGuard, recordChannelSend, type ChannelType } from '@/lib/channels/channel-guard';
import { sendLinkedInConnect, sendLinkedInDm, type SendResult } from '@/lib/channels/unipile';
import { sendEmail } from '@/lib/email/resend';

interface TemplateStep {
  step_index: number;
  delay_days: number;
  template_key: string;
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status, outbound_message_id, partner_id, template_id, step_index, channel')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  if (step.status !== 'queued_for_approval') {
    return NextResponse.json({ error: `Step is ${step.status}, not awaiting approval` }, { status: 400 });
  }
  if (!step.outbound_message_id) {
    return NextResponse.json({ error: 'Step has no outbound_message — re-render via sequencer' }, { status: 400 });
  }

  // Load message + channel + partner + template (template needed for re-anchoring).
  const [{ data: msg }, { data: partner }, { data: template }] = await Promise.all([
    db
      .from('outbound_messages')
      .select('id, channel, client_channel_id, rendered_subject, rendered_body')
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
  ]);

  if (!msg) return NextResponse.json({ error: 'Outbound message missing' }, { status: 500 });
  if (!partner) return NextResponse.json({ error: 'Partner missing' }, { status: 500 });

  const channelType = msg.channel as ChannelType;
  const guard = await checkChannelGuard(db, msg.client_channel_id, channelType);
  if (!guard.allowed) {
    return NextResponse.json({ error: `Channel guard blocked send: ${guard.reason}` }, { status: 429 });
  }

  // Look up the Unipile account_id (oauth_token_ref) for LinkedIn sends. Email
  // continues via Resend in Sprint 1 (existing wiring); switching email to
  // Unipile is a Sprint 2 change.
  const { data: channelRow } = await db
    .from('client_channels')
    .select('oauth_token_ref, provider')
    .eq('id', msg.client_channel_id)
    .single();

  let sendResult: SendResult;

  try {
    if (channelType === 'linkedin_connect') {
      if (!partner.contact_linkedin) {
        return NextResponse.json({ error: 'Partner has no contact_linkedin URL' }, { status: 400 });
      }
      if (!channelRow?.oauth_token_ref) {
        return NextResponse.json({ error: 'LinkedIn channel missing Unipile account id' }, { status: 500 });
      }
      sendResult = await sendLinkedInConnect({
        account_id: channelRow.oauth_token_ref,
        recipient_profile_url: partner.contact_linkedin,
        message: msg.rendered_body,
      });
    } else if (channelType === 'linkedin_dm') {
      if (!partner.contact_linkedin) {
        return NextResponse.json({ error: 'Partner has no contact_linkedin URL' }, { status: 400 });
      }
      if (!channelRow?.oauth_token_ref) {
        return NextResponse.json({ error: 'LinkedIn channel missing Unipile account id' }, { status: 500 });
      }
      sendResult = await sendLinkedInDm({
        account_id: channelRow.oauth_token_ref,
        recipient_profile_url: partner.contact_linkedin,
        body: msg.rendered_body,
      });
    } else if (channelType === 'email') {
      if (!partner.contact_email) {
        return NextResponse.json({ error: 'Partner has no contact_email' }, { status: 400 });
      }
      if (!msg.rendered_subject) {
        return NextResponse.json({ error: 'Email message has no subject' }, { status: 500 });
      }
      const r = await sendEmail({
        to: partner.contact_email,
        subject: msg.rendered_subject,
        body: msg.rendered_body,
      });
      sendResult = r.id ? { ok: true, message_id: r.id } : { ok: false, error: r.error };
    } else {
      return NextResponse.json({ error: `Unknown channel: ${channelType}` }, { status: 400 });
    }
  } catch (err) {
    sendResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const nowIso = new Date().toISOString();

  if (!sendResult.ok) {
    // Persist failure on both step and outbound_message so the approval queue
    // shows what happened and the operator can retry or skip.
    await db
      .from('sequence_steps')
      .update({ status: 'failed', executed_at: nowIso })
      .eq('id', step.id);
    await db
      .from('outbound_messages')
      .update({
        approved_by: user!.id,
        approved_at: nowIso,
        send_error: sendResult.error || 'Unknown send error',
      })
      .eq('id', msg.id);

    await db.from('audit_events').insert({
      organisation_id: profile.organisation_id,
      actor: `user:${user!.id}`,
      action: 'approval.send_failed',
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

    return NextResponse.json({ ok: false, error: sendResult.error }, { status: 502 });
  }

  // Success path.
  await recordChannelSend(db, msg.client_channel_id);

  await db
    .from('sequence_steps')
    .update({ status: 'sent', executed_at: nowIso })
    .eq('id', step.id);

  await db
    .from('outbound_messages')
    .update({
      approved_by: user!.id,
      approved_at: nowIso,
      sent_at: nowIso,
      channel_message_id: sendResult.message_id || null,
    })
    .eq('id', msg.id);

  // Re-anchor future pending steps for this partner+template so their
  // scheduled_for is relative to actual send, not original assign.
  await reanchorFutureSteps(db, {
    organisationId: profile.organisation_id,
    partnerId: step.partner_id,
    templateId: step.template_id,
    sentStepIndex: step.step_index,
    sentAt: nowIso,
    templateSteps: (template?.steps as TemplateStep[]) || [],
  });

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'approval.sent',
    resource_type: 'outbound_message',
    resource_id: msg.id,
    payload: {
      step_id: step.id,
      partner_id: step.partner_id,
      channel: channelType,
      channel_message_id: sendResult.message_id,
      daily_remaining: guard.daily_remaining,
    },
  });

  return NextResponse.json({ ok: true, message_id: sendResult.message_id });
}

async function reanchorFutureSteps(
  db: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
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
    if (deltaDays < 0) continue; // misordered template; leave it
    const newScheduledFor = new Date(sentAtMs + deltaDays * 86400 * 1000).toISOString();
    await db.from('sequence_steps').update({ scheduled_for: newScheduledFor }).eq('id', p.id);
  }
}
