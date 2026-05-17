/**
 * GET /api/team/members
 *
 * List all profiles in the current user's organisation, plus a count of
 * active channels each member owns (so the /settings/team UI can show
 * who has connected their LinkedIn / email and who hasn't yet).
 *
 * Open to any authenticated org member — full org visibility per the
 * locked teams design (project_teams_design_decisions.md decision 6).
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export const dynamic = 'force-dynamic';

export async function GET() {
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

  const { data: members } = await db
    .from('profiles')
    .select('id, full_name, email, role, created_at')
    .eq('organisation_id', profile.organisation_id)
    .order('created_at', { ascending: true });

  const { data: channels } = await db
    .from('client_channels')
    .select('user_id, channel_type, status')
    .eq('organisation_id', profile.organisation_id);

  type ChannelRow = { user_id: string | null; channel_type: string; status: string };
  const channelsByUser: Record<string, { linkedin: number; email: number }> = {};
  for (const c of (channels || []) as ChannelRow[]) {
    if (!c.user_id || c.status !== 'active') continue;
    if (!channelsByUser[c.user_id]) channelsByUser[c.user_id] = { linkedin: 0, email: 0 };
    if (c.channel_type === 'linkedin') channelsByUser[c.user_id].linkedin += 1;
    if (c.channel_type === 'email') channelsByUser[c.user_id].email += 1;
  }

  const enriched = (members || []).map((m) => ({
    ...m,
    channels: channelsByUser[m.id] || { linkedin: 0, email: 0 },
    is_self: m.id === user!.id,
  }));

  return NextResponse.json({ members: enriched });
}
