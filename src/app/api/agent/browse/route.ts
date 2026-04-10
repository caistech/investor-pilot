import { authenticateAndGetDb } from '@/lib/agent/db';
import { runBrowseStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, candidates } = await request.json();

  const result = await runBrowseStage(candidates);

  for (const event of result.events) {
    await db.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  await db
    .from('agent_sessions')
    .update({ current_stage: result.success ? 'browse' : 'score' })
    .eq('id', session_id);

  return NextResponse.json(result);
}
