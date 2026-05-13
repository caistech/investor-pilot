import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { resumeChannel } from '@/lib/channels/channel-guard';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: ch } = await db
    .from('client_channels')
    .select('id')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  await resumeChannel(db, params.id);

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'channel.resumed',
    resource_type: 'client_channel',
    resource_id: params.id,
  });

  return NextResponse.json({ ok: true });
}
