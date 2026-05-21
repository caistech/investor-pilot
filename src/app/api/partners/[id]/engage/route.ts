/**
 * POST /api/partners/[id]/engage
 *
 * Mark a prospect as having engaged with a value offer (pilot started,
 * brief downloaded, positive reply, intro made). Sets engaged_at,
 * engagement_type, engagement_note. Distinct from replied (any inbound)
 * and meeting_booked (post-conversation).
 *
 * Body:
 *   {
 *     engagement_type?: string,    // free text; e.g. 'pilot_started'
 *     engagement_note?: string,    // operator context
 *     status?: string,             // optional: also bump partners.status
 *   }
 *
 * DELETE /api/partners/[id]/engage
 * Un-marks (clears engaged_at). Operator may have flagged in error.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const engagementType: string | null = typeof body?.engagement_type === 'string' ? body.engagement_type.slice(0, 80) : null;
  const engagementNote: string | null = typeof body?.engagement_note === 'string' ? body.engagement_note.slice(0, 2000) : null;
  const newStatus: string | null = typeof body?.status === 'string' ? body.status.slice(0, 60) : null;

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }
  const orgId = profile.active_organisation_id;

  const { data: existing } = await db
    .from('partners')
    .select('id')
    .eq('id', params.id)
    .eq('organisation_id', orgId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    engaged_at: new Date().toISOString(),
    engagement_type: engagementType || 'manual',
    engagement_note: engagementNote,
  };
  if (newStatus) update.status = newStatus;

  const { error: updateError } = await db
    .from('partners')
    .update(update)
    .eq('id', params.id)
    .eq('organisation_id', orgId);
  if (updateError) {
    return NextResponse.json({ error: `Update failed: ${updateError.message}` }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'partner.engaged',
    resource_type: 'partner',
    resource_id: params.id,
    payload: { engagement_type: engagementType, engagement_note: engagementNote, status: newStatus },
  });

  return NextResponse.json({ ok: true, ...update });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
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
  const orgId = profile.active_organisation_id;

  const { error: updateError } = await db
    .from('partners')
    .update({ engaged_at: null, engagement_type: null, engagement_note: null })
    .eq('id', params.id)
    .eq('organisation_id', orgId);
  if (updateError) {
    return NextResponse.json({ error: `Update failed: ${updateError.message}` }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'partner.engagement_cleared',
    resource_type: 'partner',
    resource_id: params.id,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
