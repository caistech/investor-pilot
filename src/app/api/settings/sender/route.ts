/**
 * PATCH /api/settings/sender
 *
 * Updates sender_name / sender_role / signature_block on the caller's
 * organisation. These values are interpolated into the sequencer message
 * templates as {sender_name} and {sender_role}, so editing here changes
 * how every subsequent outbound LinkedIn DM and email is signed.
 *
 * Fields are nullable individually but the renderer requires sender_name
 * + sender_role to be non-empty before it will render any step. The form
 * enforces that on the client; the route guards it on the server.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

interface SenderPatchBody {
  sender_name?: string;
  sender_role?: string;
  signature_block?: string | null;
}

export async function PATCH(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as SenderPatchBody;

  const senderName = typeof body.sender_name === 'string' ? body.sender_name.trim() : undefined;
  const senderRole = typeof body.sender_role === 'string' ? body.sender_role.trim() : undefined;
  const signatureBlock =
    body.signature_block === null
      ? null
      : typeof body.signature_block === 'string'
        ? body.signature_block.trim() || null
        : undefined;

  if (senderName !== undefined && senderName === '') {
    return NextResponse.json({ error: 'sender_name cannot be blank' }, { status: 400 });
  }
  if (senderRole !== undefined && senderRole === '') {
    return NextResponse.json({ error: 'sender_role cannot be blank' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const update: Record<string, string | null> = {};
  if (senderName !== undefined) update.sender_name = senderName;
  if (senderRole !== undefined) update.sender_role = senderRole;
  if (signatureBlock !== undefined) update.signature_block = signatureBlock;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateErr } = await db
    .from('organisations')
    .update(update)
    .eq('id', profile.organisation_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
