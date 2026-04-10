import { authenticateAndGetDb } from '@/lib/agent/db';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, current_stage, partners_added, contacts_found } = await request.json();

  const update: Record<string, unknown> = { current_stage };
  if (partners_added !== undefined) update.partners_added = partners_added;
  if (contacts_found !== undefined) update.contacts_found = contacts_found;

  await db
    .from('agent_sessions')
    .update(update)
    .eq('id', session_id);

  return NextResponse.json({ success: true });
}
