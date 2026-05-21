import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { pauseChannel } from '@/lib/channels/channel-guard';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const reason = body.reason || 'Manual pause';

  // Verify the channel belongs to the user's org
  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: ch } = await db
    .from('client_channels')
    .select('id')
    .eq('id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .single();

  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  await pauseChannel(db, params.id, reason);

  await db.from('audit_events').insert({
    organisation_id: profile.active_organisation_id,
    actor: `user:${user!.id}`,
    action: 'channel.paused',
    resource_type: 'client_channel',
    resource_id: params.id,
    payload: { reason },
  });

  return NextResponse.json({ ok: true });
}
