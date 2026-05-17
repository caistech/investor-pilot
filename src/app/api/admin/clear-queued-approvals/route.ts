/**
 * POST /api/admin/clear-queued-approvals
 *
 * Bulk-skip every step currently sitting in the approvals queue for the
 * caller's organisation. Use this when stale renders (e.g. drafts rendered
 * against a now-deactivated template) need wiping before fresh ones can
 * flow through.
 *
 * Body: optional { include_blocked?: boolean } — when true also clears
 *       compliance_blocked rows. Defaults to false (queued_for_approval
 *       only) so accidental clicks don't wipe rows the operator might
 *       want to re-render via /api/admin/rerender-approvals.
 *
 * Response: { ok, cleared: number }
 *
 * Status transition mirrors the per-step skip route — sets status to
 * 'skipped' and emits one audit_events row per cleared step so the
 * timeline reflects who triggered the bulk clear and when.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const includeBlocked = body?.include_blocked === true;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.organisation_id;

  const statuses = includeBlocked
    ? ['queued_for_approval', 'compliance_blocked']
    : ['queued_for_approval'];

  // Pull the ids first so we can emit a row-per-step audit trail. Without
  // the ids we'd only know "n rows updated" — losing the resource_id link
  // that the audit timeline depends on for per-step click-through.
  const { data: targets, error: selectError } = await db
    .from('sequence_steps')
    .select('id')
    .eq('organisation_id', organisation_id)
    .in('status', statuses);

  if (selectError) {
    return NextResponse.json(
      { error: `Failed to list queued approvals: ${selectError.message}` },
      { status: 500 },
    );
  }

  const ids = (targets || []).map((t) => t.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, cleared: 0 });
  }

  const { error: updateError } = await db
    .from('sequence_steps')
    .update({ status: 'skipped' })
    .in('id', ids);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to skip queued approvals: ${updateError.message}` },
      { status: 500 },
    );
  }

  // Single bulk audit row rather than one-per-step — the per-id list is
  // captured in the payload. Keeps audit_events tidy when an operator
  // clears 50+ stale rows after a template regeneration. Mirrors the
  // shape used by /api/admin/rerender-approvals.
  await db.from('audit_events').insert({
    organisation_id,
    actor: `user:${user!.id}`,
    action: 'approvals.bulk_skipped',
    resource_type: 'organisation',
    resource_id: organisation_id,
    payload: { cleared: ids.length, include_blocked: includeBlocked, ids },
  });

  return NextResponse.json({ ok: true, cleared: ids.length });
}
