import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

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

  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });

  await db
    .from('sequence_steps')
    .update({ status: 'skipped' })
    .eq('id', params.id);

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'approval.skipped',
    resource_type: 'sequence_step',
    resource_id: params.id,
  });

  return NextResponse.json({ ok: true });
}
