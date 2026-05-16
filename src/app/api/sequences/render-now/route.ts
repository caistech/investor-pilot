/**
 * POST /api/sequences/render-now
 *
 * Operator-triggered render of the FIRST pending sequence_step for each
 * selected partner. Same code path as the 15-minute cron — just invoked
 * synchronously so the operator doesn't have to wait. Hits Approvals
 * immediately on success.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Returns:
 *   {
 *     ok: true,
 *     processed: number,
 *     counts: { queued?: number, compliance_blocked?: number, failed?: number, skipped_no_channel?: number },
 *     results: [...]
 *   }
 *
 * The cron is the source of truth for rendering semantics — this route is
 * a thin wrapper around its runSequencer() helper with the partner_ids
 * filter applied and scheduled_for enforcement disabled.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { runSequencer } from '@/lib/sequencer/runner';

export const maxDuration = 60;

const MAX_PARTNERS_PER_REQUEST = 20;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const partnerIds: string[] = Array.isArray(body.partner_ids) ? body.partner_ids : [];

  if (partnerIds.length === 0) {
    return NextResponse.json({ error: 'partner_ids (non-empty array) required' }, { status: 400 });
  }
  if (partnerIds.length > MAX_PARTNERS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch size ${partnerIds.length} exceeds limit ${MAX_PARTNERS_PER_REQUEST}` },
      { status: 400 },
    );
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Defence-in-depth: only render steps that belong to this org, even if
  // a malicious client passes another org's partner_ids. The cron uses
  // service-role and doesn't enforce org boundaries because Vercel cron
  // is trusted; operator-triggered calls aren't.
  const { data: orgPartners } = await db
    .from('partners')
    .select('id')
    .in('id', partnerIds)
    .eq('organisation_id', profile.organisation_id);

  const allowedIds = (orgPartners || []).map((p) => p.id as string);
  if (allowedIds.length === 0) {
    return NextResponse.json(
      { error: 'None of the supplied partners belong to your organisation' },
      { status: 403 },
    );
  }

  const result = await runSequencer({
    partnerIds: allowedIds,
    ignoreSchedule: true,
    organisationId: profile.organisation_id,
    skipWarmupTick: true,
  });

  return result;
}
