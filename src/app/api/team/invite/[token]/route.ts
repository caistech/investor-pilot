/**
 * GET    /api/team/invite/[token]  → fetch invitation details (public; used by /invite/accept page)
 * POST   /api/team/invite/[token]  → accept invitation (auth required, signed-in user's email is bound)
 * DELETE /api/team/invite/[token]  → revoke invitation (owner/admin of the org)
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { createServiceClient } from '@/lib/supabase/server';

type RouteContext = { params: { token: string } };

/**
 * Lookup invitation by token. Used by /invite/accept page to render the
 * "Daniel invited you to LingoPure" prompt before the user clicks accept.
 * No auth required — anyone with the token can read the (non-sensitive)
 * org + role + inviter info. The token itself is the secret.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const admin = createServiceClient();

  const { data: invitation } = await admin
    .from('org_invitations')
    .select('id, email, role, organisation_id, invited_by, expires_at, accepted_at, revoked_at')
    .eq('token', params.token)
    .maybeSingle();

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }

  if (invitation.revoked_at) {
    return NextResponse.json({ error: 'Invitation revoked', status: 'revoked' }, { status: 410 });
  }
  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'Invitation already accepted', status: 'accepted' }, { status: 410 });
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitation expired', status: 'expired' }, { status: 410 });
  }

  const { data: org } = await admin
    .from('organisations')
    .select('name, slug')
    .eq('id', invitation.organisation_id)
    .single();

  let inviterName: string | null = null;
  if (invitation.invited_by) {
    const { data: inviter } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', invitation.invited_by)
      .single();
    inviterName = inviter?.full_name || inviter?.email || null;
  }

  return NextResponse.json({
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expires_at: invitation.expires_at,
      organisation: { name: org?.name, slug: org?.slug },
      inviter_name: inviterName,
    },
  });
}

/**
 * Accept invitation. Requires the caller to be signed in as the invited
 * email (case-insensitive). Inserts memberships row, marks invitation
 * accepted, writes audit event, sets the new org as active so the
 * downstream redirect lands the user in the right place.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: invitation } = await db!
    .from('org_invitations')
    .select('id, email, role, organisation_id, expires_at, accepted_at, revoked_at')
    .eq('token', params.token)
    .maybeSingle();

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }
  if (invitation.revoked_at) {
    return NextResponse.json({ error: 'Invitation has been revoked' }, { status: 410 });
  }
  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'Invitation already accepted' }, { status: 410 });
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 });
  }

  if (user!.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return NextResponse.json({
      error: `This invitation was sent to ${invitation.email}. Please log out and sign in as that user, or ask the inviter to resend to your current email.`,
    }, { status: 403 });
  }

  // Insert membership (idempotent — already-member is fine).
  const { error: membershipError } = await db!
    .from('memberships')
    .upsert({
      user_id: user!.id,
      organisation_id: invitation.organisation_id,
      role: invitation.role,
    }, { onConflict: 'user_id,organisation_id' });

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  // Mark invitation accepted.
  await db!
    .from('org_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  // Switch the user's active org to the one they just joined so the
  // downstream redirect lands them in the right context.
  await db!
    .from('profiles')
    .update({ active_organisation_id: invitation.organisation_id })
    .eq('id', user!.id);

  // Audit trail.
  await db!.from('audit_events').insert({
    organisation_id: invitation.organisation_id,
    actor: `user:${user!.id}`,
    action: 'team.accepted',
    resource_type: 'org_invitation',
    resource_id: invitation.id,
    payload: { email: invitation.email, role: invitation.role },
  });

  const { data: org } = await db!
    .from('organisations')
    .select('slug')
    .eq('id', invitation.organisation_id)
    .single();

  return NextResponse.json({
    ok: true,
    redirect: `/org/${org?.slug}/dashboard`,
  });
}

/**
 * Revoke pending invitation. Owner/admin of the org that owns the
 * invitation only. Sets revoked_at so the token becomes invalid even
 * if the email has already been delivered.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { user, db, orgId, role: callerRole, error } = await authenticateAndGetDb();
  if (error) return error;

  if (callerRole !== 'owner' && callerRole !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can revoke invitations' }, { status: 403 });
  }

  const { data: invitation } = await db!
    .from('org_invitations')
    .select('id, organisation_id, accepted_at, revoked_at')
    .eq('token', params.token)
    .maybeSingle();

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }
  if (invitation.organisation_id !== orgId) {
    return NextResponse.json({ error: 'Invitation belongs to a different organisation' }, { status: 403 });
  }
  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'Cannot revoke — invitation already accepted' }, { status: 410 });
  }
  if (invitation.revoked_at) {
    return NextResponse.json({ ok: true, already_revoked: true });
  }

  await db!
    .from('org_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitation.id);

  await db!.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.revoked',
    resource_type: 'org_invitation',
    resource_id: invitation.id,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
