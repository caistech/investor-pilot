/**
 * POST /api/partners/[id]/note
 *
 * Operator-injected evidence note. Lets the operator paste private
 * context about a prospect that the public discovery sources (Brave /
 * LinkedIn) couldn't surface — e.g. "I met them at SaaStr last year,
 * they mentioned they're actively looking at EdTech deals in SEA."
 *
 * Persists to partners.last_session_notes. The fit-signal extractor
 * reads this column alongside the auto-collected evidence, so the next
 * render uses the operator's private knowledge as ground truth.
 *
 * Body:
 *   { note: string, append?: boolean }
 *
 * When append=true, the note is appended (with a separator + dated
 * header) to whatever's already in last_session_notes. Default false
 * (overwrite) so the operator can fix a typo without orphan history.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

const MAX_NOTE_LENGTH = 4000;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const append = body.append === true;

  if (note.length === 0) {
    return NextResponse.json({ error: 'note required (non-empty string)' }, { status: 400 });
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `note exceeds ${MAX_NOTE_LENGTH} chars` }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }
  const orgId = profile.organisation_id;

  // Org-scoped fetch — defensive.
  const { data: existing } = await db
    .from('partners')
    .select('id, last_session_notes')
    .eq('id', params.id)
    .eq('organisation_id', orgId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  }

  const newNotes = append && existing.last_session_notes
    ? `${existing.last_session_notes}\n\n--- ${new Date().toISOString().slice(0, 10)} ---\n${note}`
    : note;

  const { error: updateError } = await db
    .from('partners')
    .update({ last_session_notes: newNotes.slice(0, MAX_NOTE_LENGTH * 2) })
    .eq('id', params.id)
    .eq('organisation_id', orgId);

  if (updateError) {
    return NextResponse.json({ error: `Update failed: ${updateError.message}` }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'partner.note_added',
    resource_type: 'partner',
    resource_id: params.id,
    payload: { append, note_length: note.length },
  });

  return NextResponse.json({ ok: true, last_session_notes: newNotes });
}
