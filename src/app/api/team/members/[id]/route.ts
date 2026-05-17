/**
 * PATCH /api/team/members/[id] — change a member's role (owner only)
 * DELETE /api/team/members/[id] — remove a member from the org (owner only)
 *
 * Both gated on the caller having profiles.role = 'owner'. Removing a
 * member sets their channels to status='revoked' so the sequencer
 * stops trying to send via them.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const supabaseAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function assertOwner(currentUserId: string) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organisation_id, role')
    .eq('id', currentUserId)
    .single();
  if (!profile?.organisation_id) {
    return { error: NextResponse.json({ error: 'No organisation' }, { status: 400 }), orgId: null };
  }
  if (profile.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Only owners can manage team members' }, { status: 403 }), orgId: null };
  }
  return { error: null, orgId: profile.organisation_id };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { user, error } = await authenticateAndGetDb();
  if (error) return error;

  const { orgId, error: ownerError } = await assertOwner(user!.id);
  if (ownerError) return ownerError;

  const { role } = (await request.json()) as { role?: 'owner' | 'admin' | 'member' };
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'role must be owner | admin | member' }, { status: 400 });
  }

  // Verify the target is in the same org
  const { data: target } = await supabaseAdmin
    .from('profiles')
    .select('id, organisation_id, role')
    .eq('id', params.id)
    .single();
  if (!target || target.organisation_id !== orgId) {
    return NextResponse.json({ error: 'Member not found in your organisation' }, { status: 404 });
  }

  // Prevent demoting the LAST owner — orgs need at least one owner
  if (target.role === 'owner' && role !== 'owner') {
    const { count } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('role', 'owner');
    if ((count || 0) <= 1) {
      return NextResponse.json({ error: 'Cannot demote the last owner — promote another member to owner first' }, { status: 400 });
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', params.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabaseAdmin.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.role_changed',
    resource_type: 'profile',
    resource_id: params.id,
    payload: { new_role: role, previous_role: target.role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { user, error } = await authenticateAndGetDb();
  if (error) return error;

  const { orgId, error: ownerError } = await assertOwner(user!.id);
  if (ownerError) return ownerError;

  if (params.id === user!.id) {
    return NextResponse.json({ error: 'You cannot remove yourself — transfer ownership first or have another owner do it' }, { status: 400 });
  }

  const { data: target } = await supabaseAdmin
    .from('profiles')
    .select('id, organisation_id, role')
    .eq('id', params.id)
    .single();
  if (!target || target.organisation_id !== orgId) {
    return NextResponse.json({ error: 'Member not found in your organisation' }, { status: 404 });
  }

  if (target.role === 'owner') {
    return NextResponse.json({ error: 'Cannot remove an owner — demote them to admin/member first' }, { status: 400 });
  }

  // Revoke their channels so the sequencer stops trying to send via them
  await supabaseAdmin
    .from('client_channels')
    .update({ status: 'revoked', pause_reason: 'Team member removed' })
    .eq('user_id', params.id)
    .eq('organisation_id', orgId);

  // Remove the profile (their auth.users row stays — they could re-join
  // a different org). The profile is what binds them to THIS org.
  const { error: deleteError } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', params.id)
    .eq('organisation_id', orgId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  await supabaseAdmin.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.member_removed',
    resource_type: 'profile',
    resource_id: params.id,
    payload: { previous_role: target.role },
  });

  return NextResponse.json({ ok: true });
}
