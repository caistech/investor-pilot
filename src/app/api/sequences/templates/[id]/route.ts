/**
 * PATCH /api/sequences/templates/[id]   — toggle is_active
 * DELETE /api/sequences/templates/[id]  — permanent delete
 *
 * Operator-facing template management. Built 2026-05-17 when an
 * accumulated 9 templates landed on the /settings/templates page (each
 * Generate / Regenerate had been inserting instead of upserting). With
 * no UI to deactivate or delete, every regen widened the assign-batch
 * routing pool and prospects ended up on whichever template the
 * routing logic happened to pick.
 *
 * Org-scoped at the DB layer — the SELECT/UPDATE filters by
 * organisation_id matching the authenticated profile, so an operator
 * can't touch another tenant's templates even if they brute-force ids.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

interface RouteContext {
  params: { id: string };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as { is_active?: boolean };
  if (typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const { error: updateErr, data: updated } = await db
    .from('sequence_templates')
    .update({ is_active: body.is_active })
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .select('id, is_active')
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Template not found in your organisation' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: updated.id, is_active: updated.is_active });
}

export async function DELETE(request: Request, { params }: RouteContext) {
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

  // Block delete if any non-terminal sequence_step references this
  // template — orphaning in-flight steps would break the cron + leave
  // the operator with prospects assigned to a missing template. Force
  // the operator to deactivate + reset prospects first.
  const { count: liveSteps } = await db
    .from('sequence_steps')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', profile.organisation_id)
    .eq('template_id', params.id)
    .in('status', ['pending', 'awaiting_verification', 'queued_for_approval']);

  if ((liveSteps || 0) > 0) {
    return NextResponse.json(
      {
        error: `Can't delete — ${liveSteps} prospect${liveSteps === 1 ? ' is' : 's are'} still on this template. Deactivate it first (so new assignments skip it), then Reset the affected prospects' sequences in /partners before retrying delete.`,
      },
      { status: 409 },
    );
  }

  const { error: deleteErr } = await db
    .from('sequence_templates')
    .delete()
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
