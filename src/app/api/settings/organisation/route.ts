/**
 * PATCH /api/settings/organisation
 *
 * Rename the caller's organisation. Only the owner (or admins, if/when
 * roles expand) may update — but for now any member of the org can
 * rename it because the membership lookup confirms they belong.
 *
 * Other organisation-level fields (sender_*, signature_block) are
 * handled by /api/settings/sender, deliberately a separate route so
 * the surface stays small per endpoint.
 *
 * Body:
 *   { name: string }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

const MAX_NAME = 200;

export async function PATCH(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0) {
    return NextResponse.json({ error: 'name required (non-empty string)' }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `name exceeds ${MAX_NAME} chars` }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id, role')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const { error: updateErr } = await db
    .from('organisations')
    .update({ name })
    .eq('id', profile.organisation_id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, name });
}
