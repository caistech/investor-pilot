import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function DELETE(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Verify the session belongs to the user's org
  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

  const { data: session } = await supabase
    .from('agent_sessions')
    .select('id, organisation_id')
    .eq('id', id)
    .single();

  if (!session || session.organisation_id !== profile.organisation_id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Use service client to bypass RLS for delete
  const admin = createServiceClient();
  await admin.from('session_events').delete().eq('session_id', id);
  await admin.from('agent_sessions').delete().eq('id', id);

  return NextResponse.json({ success: true });
}
