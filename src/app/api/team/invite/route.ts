/**
 * POST /api/team/invite
 *
 * Owner / admin creates a pending invitation in org_invitations and emails
 * the invitee a /invite/accept?token=<token> link branded for the
 * inviter's org. The Supabase Auth inviteUserByEmail path (used pre-029)
 * couldn't invite existing auth users — this token-based flow works for
 * both fresh + existing accounts.
 *
 * Body: { email: string, role?: 'admin' | 'member' }
 * Returns: { ok: true, invitation_id: string, expires_at: string }
 */

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { sendEmail } from '@/lib/email/resend';

export async function POST(request: Request) {
  const { user, db, orgId, role: callerRole, error } = await authenticateAndGetDb();
  if (error) return error;

  if (!orgId) {
    return NextResponse.json({ error: 'No active organisation' }, { status: 400 });
  }

  if (callerRole !== 'owner' && callerRole !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can invite team members' }, { status: 403 });
  }

  const { email, role: requestedRole } = (await request.json()) as {
    email?: string;
    role?: 'member' | 'admin';
  };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  // Owners can grant admin; admins can only invite as member.
  const inviteRole = callerRole === 'owner' && requestedRole === 'admin' ? 'admin' : 'member';

  const normalisedEmail = email.trim().toLowerCase();

  // Reject duplicates: if a pending (un-accepted, un-revoked, un-expired)
  // invitation already exists for this email + org, surface it rather
  // than creating a second token. Operator can revoke + reissue if they
  // actually want a new token.
  const { data: existing } = await db!
    .from('org_invitations')
    .select('id, token, expires_at')
    .eq('organisation_id', orgId)
    .eq('email', normalisedEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      invitation_id: existing.id,
      expires_at: existing.expires_at,
      already_pending: true,
    });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error: insertError } = await db!
    .from('org_invitations')
    .insert({
      token,
      email: normalisedEmail,
      organisation_id: orgId,
      role: inviteRole,
      invited_by: user!.id,
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Fetch org + inviter name for the email body.
  const { data: org } = await db!
    .from('organisations')
    .select('name')
    .eq('id', orgId)
    .single();
  const { data: inviterProfile } = await db!
    .from('profiles')
    .select('full_name, email')
    .eq('id', user!.id)
    .single();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://investor-pilot-pi.vercel.app';
  const acceptUrl = `${baseUrl}/invite/accept?token=${token}`;
  const inviterName = inviterProfile?.full_name || inviterProfile?.email || 'Your colleague';
  const orgName = org?.name || 'an organisation';

  const subject = `${inviterName} invited you to ${orgName} on InvestorPilot`;
  const body = `Hi,

${inviterName} has invited you to join ${orgName} on InvestorPilot as a ${inviteRole}.

Click here to accept the invitation:
${acceptUrl}

This link expires in 7 days. If you don't have an InvestorPilot account yet, the link will guide you through signup.

If you weren't expecting this invitation, you can safely ignore this email.

— InvestorPilot
https://investor-pilot-pi.vercel.app`;

  const { error: sendError } = await sendEmail({
    to: normalisedEmail,
    subject,
    body,
  });

  if (sendError) {
    // Don't fail the request — invitation row is in DB, operator can
    // resend or copy the link manually from /settings/team if needed.
    console.error('[team/invite] Email send failed:', sendError);
  }

  await db!.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.invited',
    resource_type: 'org_invitation',
    resource_id: invitation.id,
    payload: { email: normalisedEmail, role: inviteRole },
  });

  return NextResponse.json({
    ok: true,
    invitation_id: invitation.id,
    expires_at: invitation.expires_at,
    email_sent: !sendError,
  });
}
