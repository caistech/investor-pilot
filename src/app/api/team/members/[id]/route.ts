/**
 * PATCH  /api/team/members/[id] — change a member's role (owner only)
 * DELETE /api/team/members/[id] — remove a member from the org. Owner can
 *   remove anyone else; a member can remove themselves (leave-org). Last
 *   owner is blocked at both paths.
 *
 * Multi-org: role + membership live on the memberships table. The profile
 * row is shared across all orgs the user belongs to and is NEVER deleted
 * here — only the memberships row for THIS org goes away.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

async function fetchTargetMembership(
  db: NonNullable<Awaited<ReturnType<typeof authenticateAndGetDb>>['db']>,
  targetUserId: string,
  orgId: string,
) {
  const { data } = await db
    .from('memberships')
    .select('user_id, role')
    .eq('user_id', targetUserId)
    .eq('organisation_id', orgId)
    .maybeSingle();
  return data;
}

async function countOwners(
  db: NonNullable<Awaited<ReturnType<typeof authenticateAndGetDb>>['db']>,
  orgId: string,
): Promise<number> {
  const { count } = await db
    .from('memberships')
    .select('user_id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .eq('role', 'owner');
  return count ?? 0;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { user, db, orgId, role: callerRole, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 400 });
  if (callerRole !== 'owner') {
    return NextResponse.json({ error: 'Only owners can change roles' }, { status: 403 });
  }

  const { role } = (await request.json()) as { role?: 'owner' | 'admin' | 'member' };
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'role must be owner | admin | member' }, { status: 400 });
  }

  const target = await fetchTargetMembership(db!, params.id, orgId);
  if (!target) {
    return NextResponse.json({ error: 'Member not found in your organisation' }, { status: 404 });
  }

  if (target.role === 'owner' && role !== 'owner') {
    const owners = await countOwners(db!, orgId);
    if (owners <= 1) {
      return NextResponse.json({ error: 'Cannot demote the last owner — promote another member to owner first' }, { status: 400 });
    }
  }

  const { error: updateError } = await db!
    .from('memberships')
    .update({ role })
    .eq('user_id', params.id)
    .eq('organisation_id', orgId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await db!.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.role_changed',
    resource_type: 'membership',
    resource_id: params.id,
    payload: { new_role: role, previous_role: target.role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, orgId, role: callerRole, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 400 });

  const target = await fetchTargetMembership(db!, params.id, orgId);
  if (!target) {
    return NextResponse.json({ error: 'Member not found in your organisation' }, { status: 404 });
  }

  const isSelf = params.id === user!.id;
  const isOwnerRemoving = callerRole === 'owner' && !isSelf;
  const isLeaveOrg = isSelf;

  if (!isOwnerRemoving && !isLeaveOrg) {
    return NextResponse.json({ error: 'Only owners can remove other members; you can only remove yourself' }, { status: 403 });
  }

  if (target.role === 'owner') {
    const owners = await countOwners(db!, orgId);
    if (owners <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last owner — promote another member to owner first' }, { status: 400 });
    }
  }

  // Revoke this user's channels in this org so the sequencer stops sending
  // via them. (Other orgs they belong to keep their channels.)
  await db!
    .from('client_channels')
    .update({ status: 'revoked', pause_reason: isSelf ? 'Left org' : 'Removed from org' })
    .eq('user_id', params.id)
    .eq('organisation_id', orgId);

  // Remove the memberships row. Profile + auth.users untouched.
  const { error: deleteError } = await db!
    .from('memberships')
    .delete()
    .eq('user_id', params.id)
    .eq('organisation_id', orgId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // If the leaving user's active_organisation_id was this org, switch them
  // to another org they're in (or null if none).
  if (isSelf) {
    const { data: remaining } = await db!
      .from('memberships')
      .select('organisation_id')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    await db!
      .from('profiles')
      .update({ active_organisation_id: remaining?.organisation_id ?? null })
      .eq('id', user!.id);
  }

  await db!.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: isSelf ? 'team.left' : 'team.member_removed',
    resource_type: 'membership',
    resource_id: params.id,
    payload: { previous_role: target.role },
  });

  return NextResponse.json({ ok: true });
}
