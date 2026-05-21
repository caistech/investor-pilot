/**
 * POST /api/approvals/[id]/approve
 *
 * Operator approval: mark the step as `approved_queued_for_send`. A
 * separate cron (/api/cron/drain-send-queue) drains the queue at the
 * channel's daily cap, dispatching via Unipile/Resend. The operator
 * pre-approves messages once; the system handles the day-boundary
 * cap reset and continues sending across days without re-clicks.
 *
 * Previously the approve handler was an INLINE send — clicking
 * 'Approve & send' dispatched right then, and the operator hit 429s
 * once the daily cap was reached. Operator flagged 2026-05-19:
 * 'happy to cap sends to daily limits but I should be able to pre-
 * approve emails for automated sending once the next day arrives.'
 *
 * The full dispatch logic (channel-guard + Unipile + Resend + outbound_message
 * bookkeeping + future-step re-anchoring) is now in src/app/api/cron/
 * drain-send-queue/route.ts. This handler does three things only:
 *   1. Validate the step + caller.
 *   2. Flip status to `approved_queued_for_send`.
 *   3. Record approver + audit trail.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status, outbound_message_id, partner_id, template_id, step_index, channel')
    .eq('id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .single();

  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  if (step.status !== 'queued_for_approval') {
    return NextResponse.json({ error: `Step is ${step.status}, not awaiting approval` }, { status: 400 });
  }
  if (!step.outbound_message_id) {
    return NextResponse.json({ error: 'Step has no outbound_message — re-render via sequencer' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  // Mark approval on both step + outbound_message. The actual send happens
  // when /api/cron/drain-send-queue picks this row up (typically within
  // 15 min of approval, or whenever the daily cap resets if exhausted).
  await db
    .from('sequence_steps')
    .update({ status: 'approved_queued_for_send', updated_at: nowIso })
    .eq('id', step.id);
  await db
    .from('outbound_messages')
    .update({ approved_by: user!.id, approved_at: nowIso })
    .eq('id', step.outbound_message_id);

  await db.from('audit_events').insert({
    organisation_id: profile.active_organisation_id,
    actor: `user:${user!.id}`,
    action: 'approval.queued_for_send',
    resource_type: 'outbound_message',
    resource_id: step.outbound_message_id,
    payload: {
      step_id: step.id,
      partner_id: step.partner_id,
      channel: step.channel,
    },
  });

  return NextResponse.json({
    ok: true,
    queued: true,
    message: 'Approved — queued for send. The drain cron will dispatch within 15 minutes, respecting your channel daily cap.',
  });
}
