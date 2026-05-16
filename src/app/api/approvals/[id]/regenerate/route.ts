/**
 * POST /api/approvals/[id]/regenerate
 *
 * Regenerates an existing queued-for-approval draft using the CURRENT
 * code path — investor-aware fit-signal extractor, target_kind-routed
 * template, latest system prompt. Lets the operator refresh a stale
 * draft (one rendered before a prompt/template fix landed) without
 * having to walk the full Reset → Assign → Render flow on the
 * Prospects page.
 *
 * Mechanism: drops the outbound_messages row, marks the step pending,
 * runs runSequencer scoped to this one partner with ignoreSchedule, then
 * returns the fresh rendered message so the Approvals card can patch
 * itself in place.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { runSequencer } from '@/lib/sequencer/runner';

export const maxDuration = 60;

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
  const orgId = profile.organisation_id;

  // Pull the step we're regenerating so we can scope runSequencer to its
  // partner and verify the org boundary.
  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status, partner_id, outbound_message_id')
    .eq('id', params.id)
    .eq('organisation_id', orgId)
    .single();

  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });

  // Only regenerate from one of the renderable states. Sent / replied is
  // historical and should never be rewritten; pending will be picked up
  // by the cron without intervention.
  const REGENERABLE = new Set(['queued_for_approval', 'compliance_blocked', 'failed']);
  if (!REGENERABLE.has(step.status as string)) {
    return NextResponse.json(
      { error: `Step is ${step.status}; only queued_for_approval / compliance_blocked / failed can be regenerated` },
      { status: 400 },
    );
  }

  // Drop the old outbound_message + reset the step. The runner will
  // produce a new outbound_message and link it via outbound_message_id.
  if (step.outbound_message_id) {
    await db
      .from('outbound_messages')
      .delete()
      .eq('id', step.outbound_message_id)
      .eq('organisation_id', orgId);
  }
  await db
    .from('sequence_steps')
    .update({ status: 'pending', outbound_message_id: null })
    .eq('id', step.id)
    .eq('organisation_id', orgId);

  // Run the renderer against just this partner. ignoreSchedule so
  // future-scheduled follow-up steps aren't dragged in alongside the
  // one the operator clicked.
  await runSequencer({
    partnerIds: [step.partner_id as string],
    organisationId: orgId,
    ignoreSchedule: true,
    skipWarmupTick: true,
    concurrency: 1,
  });

  // Re-fetch the step + its new outbound_message so the client can patch
  // the card without a full reload.
  const { data: postStep } = await db
    .from('sequence_steps')
    .select('id, status, outbound_message_id')
    .eq('id', step.id)
    .single();

  type MsgRow = { rendered_subject: string | null; rendered_body: string; compliance_check: unknown; personalization_score: number | null };
  let msgRow: MsgRow | null = null;
  if (postStep?.outbound_message_id) {
    const { data } = await db
      .from('outbound_messages')
      .select('rendered_subject, rendered_body, compliance_check, personalization_score')
      .eq('id', postStep.outbound_message_id)
      .single();
    msgRow = (data as unknown as MsgRow) ?? null;
  }

  return NextResponse.json({
    ok: true,
    step_id: step.id,
    new_status: postStep?.status ?? null,
    message_id: postStep?.outbound_message_id ?? null,
    rendered_subject: msgRow?.rendered_subject ?? null,
    rendered_body: msgRow?.rendered_body ?? null,
    compliance_check: msgRow?.compliance_check ?? null,
    personalization_score: msgRow?.personalization_score ?? null,
  });
}
