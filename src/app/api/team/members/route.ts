/**
 * GET /api/team/members
 *
 * List all members of the caller's active org via the memberships table.
 * Returns role from memberships (multi-org source of truth) joined with
 * full_name/email from profiles for display. Channel counts come from
 * client_channels scoped to (user_id, organisation_id).
 *
 * Open to any authenticated org member — full org visibility per the
 * locked teams design (project_teams_design_decisions.md decision 6).
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, db, orgId, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) {
    return NextResponse.json({ error: 'No active organisation' }, { status: 400 });
  }

  const { data: memberships } = await db!
    .from('memberships')
    .select('user_id, role, created_at')
    .eq('organisation_id', orgId)
    .order('created_at', { ascending: true });

  const userIds = (memberships || []).map((m) => m.user_id);

  const { data: profiles } = userIds.length
    ? await db!
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };

  const { data: channels } = await db!
    .from('client_channels')
    .select('user_id, channel_type, status')
    .eq('organisation_id', orgId);

  type ChannelRow = { user_id: string | null; channel_type: string; status: string };
  const channelsByUser: Record<string, { linkedin: number; email: number }> = {};
  for (const c of (channels || []) as ChannelRow[]) {
    if (!c.user_id || c.status !== 'active') continue;
    if (!channelsByUser[c.user_id]) channelsByUser[c.user_id] = { linkedin: 0, email: 0 };
    if (c.channel_type === 'linkedin') channelsByUser[c.user_id].linkedin += 1;
    if (c.channel_type === 'email') channelsByUser[c.user_id].email += 1;
  }

  const profilesById = new Map((profiles || []).map((p) => [p.id, p]));
  const enriched = (memberships || []).map((m) => {
    const profile = profilesById.get(m.user_id);
    return {
      id: m.user_id,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
      role: m.role,
      created_at: m.created_at,
      channels: channelsByUser[m.user_id] || { linkedin: 0, email: 0 },
      is_self: m.user_id === user!.id,
    };
  });

  return NextResponse.json({ members: enriched });
}
