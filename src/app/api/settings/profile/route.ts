/**
 * PATCH /api/settings/profile
 *
 * Update the caller's profile name. Email is intentionally not editable
 * here — that requires a Supabase auth re-verification flow handled
 * separately. Role is admin-only (multi-user permissioning not yet
 * exposed; defer when needed).
 *
 * Body:
 *   { name: string }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

const MAX_NAME = 120;

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

  // Column is full_name on the profiles table (migration 001); wire
  // field stays `name` for caller simplicity.
  const { error: updateErr } = await db
    .from('profiles')
    .update({ full_name: name })
    .eq('id', user!.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, name });
}
