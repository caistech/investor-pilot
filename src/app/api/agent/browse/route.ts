import { authenticateAndGetDb } from '@/lib/agent/db';
import { runBrowseForPartner } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, candidate } = await request.json();

  const result = await runBrowseForPartner(candidate);

  for (const event of result.events) {
    await db.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  // Session stage update is handled by the client after all partners are browsed

  return NextResponse.json(result);
}
