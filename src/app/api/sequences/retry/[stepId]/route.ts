/**
 * POST /api/sequences/retry/[stepId]
 *
 * Resets a failed or compliance_blocked sequence step back to 'pending'
 * so the next cron tick re-renders it with the current code + prompt.
 * Useful after:
 *   - A Unipile / Resend send failed and you've fixed the underlying issue
 *   - The compliance gate blocked the render and you've enriched the
 *     partner's evidence so credit_signal extraction will now succeed
 *   - Any code-side fix (prompt change, model swap, etc.)
 *
 * Clears outbound_message_id so the cron creates a fresh outbound_message
 * row on retry. The original failed/blocked outbound stays in place as
 * audit history — visible in the Communications timeline.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

const RETRYABLE = ['failed', 'compliance_blocked'];

export async function POST(_request: Request, { params }: { params: { stepId: string } }) {
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

  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status, partner_id, template_id, step_index, outbound_message_id')
    .eq('id', params.stepId)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!step) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  }

  if (!RETRYABLE.includes(step.status)) {
    return NextResponse.json(
      { error: `Step is ${step.status}; only failed and compliance_blocked steps can be retried` },
      { status: 400 },
    );
  }

  const { error: updateError } = await db
    .from('sequence_steps')
    .update({
      status: 'pending',
      outbound_message_id: null,
      executed_at: null,
      // Schedule for now so the next cron tick picks it up immediately
      // rather than honouring the original scheduled_for (which may be
      // days in the past now).
      scheduled_for: new Date().toISOString(),
    })
    .eq('id', step.id);

  if (updateError) {
    return NextResponse.json({ error: `Update failed: ${updateError.message}` }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'sequence.retried',
    resource_type: 'sequence_step',
    resource_id: step.id,
    payload: {
      partner_id: step.partner_id,
      step_index: step.step_index,
      from_status: step.status,
      cleared_outbound_message_id: step.outbound_message_id,
    },
  });

  return NextResponse.json({
    ok: true,
    step_id: step.id,
    from_status: step.status,
    to_status: 'pending',
  });
}
