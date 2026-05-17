/**
 * POST /api/team/invite
 *
 * Owner / admin invites a new team member by email. Uses Supabase Auth's
 * inviteUserByEmail under the hood so the invitee gets a branded email
 * (via the org-configured Resend SMTP — sender
 * noreply@updates.corporateaisolutions.com per the global rule), clicks
 * the link, sets a password, and lands in the dashboard already joined
 * to the inviter's org with role=member.
 *
 * The organisation_id + role are stashed in user_metadata so the
 * /auth/callback handler (which runs on first sign-in) knows to JOIN
 * them to the existing org rather than spin up a fresh one.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const supabaseAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { email, role: requestedRole } = (await request.json()) as {
    email?: string;
    role?: 'member' | 'admin';
  };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id, role')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  if (profile.role !== 'owner' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can invite team members' }, { status: 403 });
  }

  // Owners can grant admin; admins can only invite as member.
  const role = profile.role === 'owner' && requestedRole === 'admin' ? 'admin' : 'member';

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL || 'https://investor-pilot-pi.vercel.app'}/auth/callback`;

  const { data, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      organisation_id: profile.organisation_id,
      role,
      invited_by: user!.id,
    },
    redirectTo,
  });

  if (inviteError) {
    // Treat "already registered" as a soft case — surface to caller.
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  // Audit trail.
  await supabaseAdmin.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'team.invited',
    resource_type: 'auth_user',
    resource_id: data.user?.id || null,
    payload: { email, role },
  });

  return NextResponse.json({ ok: true, invited_user_id: data.user?.id, email, role });
}
