/**
 * POST /api/sequences/cancel/[partnerId]
 *
 * Cancels every non-terminal sequence step for a partner. Marks them
 * 'skipped' (not 'failed' or 'compliance_blocked' — those imply something
 * went wrong; this is an explicit operator action). Audit-logs the cancel
 * so the trail makes sense later.
 *
 * Idempotent: re-running on a partner with no non-terminal steps is a
 * no-op that returns `{ ok: true, cancelled: 0 }`.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

// Statuses that mean "still in flight" — these are what we cancel.
const NON_TERMINAL = [
  'pending',
  'awaiting_verification',
  'queued_for_approval',
  'compliance_blocked',
  'failed',
];

export async function POST(_request: Request, { params }: { params: { partnerId: string } }) {
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

  // Fetch the steps we're about to cancel so we can audit-log the exact
  // set. Without this we'd just have a row count, which makes the audit
  // trail less useful when investigating later.
  const { data: stepsToCancel, error: fetchError } = await db
    .from('sequence_steps')
    .select('id, step_index, channel, template_id, status')
    .eq('organisation_id', profile.organisation_id)
    .eq('partner_id', params.partnerId)
    .in('status', NON_TERMINAL);

  if (fetchError) {
    return NextResponse.json({ error: `Lookup failed: ${fetchError.message}` }, { status: 500 });
  }

  if (!stepsToCancel || stepsToCancel.length === 0) {
    return NextResponse.json({ ok: true, cancelled: 0 });
  }

  const { error: updateError } = await db
    .from('sequence_steps')
    .update({ status: 'skipped' })
    .in('id', stepsToCancel.map(s => s.id));

  if (updateError) {
    return NextResponse.json({ error: `Update failed: ${updateError.message}` }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'sequence.cancelled',
    resource_type: 'partner',
    resource_id: params.partnerId,
    payload: {
      cancelled_count: stepsToCancel.length,
      cancelled_step_ids: stepsToCancel.map(s => s.id),
      cancelled_from_statuses: Array.from(new Set(stepsToCancel.map(s => s.status))),
    },
  });

  return NextResponse.json({
    ok: true,
    cancelled: stepsToCancel.length,
    step_ids: stepsToCancel.map(s => s.id),
  });
}
