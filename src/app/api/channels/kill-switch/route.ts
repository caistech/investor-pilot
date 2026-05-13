import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { killSwitch } from '@/lib/channels/channel-guard';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const reason = body.reason || 'Operator kill switch';

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const result = await killSwitch(db, profile.organisation_id, reason);

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'channel.kill_switch',
    resource_type: 'organisation',
    resource_id: profile.organisation_id,
    payload: { reason, paused_count: result.paused_count },
  });

  return NextResponse.json({ ok: true, paused_count: result.paused_count });
}
