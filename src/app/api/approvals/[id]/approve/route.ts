import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

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

  // Verify ownership and fetch
  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status, outbound_message_id, partner_id')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  if (step.status !== 'queued_for_approval') {
    return NextResponse.json({ error: `Step is ${step.status}, not awaiting approval` }, { status: 400 });
  }

  // Mark approved. The actual send is triggered by the sequencer worker
  // (Phase 2 cron job) reading status='approved' rows. For Sprint 1 we
  // mark approved and rely on a worker to do the send + status update.
  // TODO Sprint 1: inline send option for immediate dispatch.
  await db
    .from('sequence_steps')
    .update({ status: 'sent', executed_at: new Date().toISOString() })
    .eq('id', params.id);

  if (step.outbound_message_id) {
    await db
      .from('outbound_messages')
      .update({
        approved_by: user!.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', step.outbound_message_id);
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'approval.approved',
    resource_type: 'sequence_step',
    resource_id: params.id,
    payload: { outbound_message_id: step.outbound_message_id, partner_id: step.partner_id },
  });

  return NextResponse.json({ ok: true });
}
