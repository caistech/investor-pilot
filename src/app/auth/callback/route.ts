import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { slugify } from '@/lib/utils';
import { bootstrapEmailChannel } from '@/lib/channels/bootstrap';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Service client for org/profile/membership creation (bypasses RLS).
      const admin = createServiceClient();

      const { data: profile } = await admin
        .from('profiles')
        .select('id, active_organisation_id')
        .eq('id', data.user.id)
        .single();

      if (!profile) {
        const meta = data.user.user_metadata;
        // Teams iteration: /api/team/invite stamps invited_org metadata
        // on the new auth user; if present, join that org as the invited
        // role rather than creating a fresh one.
        const invitedOrgId = meta?.organisation_id || meta?.invited_organisation_id;
        const invitedRole = meta?.role || 'member';

        if (invitedOrgId) {
          await admin.from('profiles').insert({
            id: data.user.id,
            active_organisation_id: invitedOrgId,
            organisation_id: invitedOrgId,
            full_name: meta?.full_name || null,
            email: data.user.email,
            role: invitedRole === 'admin' || invitedRole === 'owner' ? invitedRole : 'member',
          });
          await admin.from('memberships').insert({
            user_id: data.user.id,
            organisation_id: invitedOrgId,
            role: invitedRole === 'admin' || invitedRole === 'owner' ? invitedRole : 'member',
          });
        } else {
          const orgName = meta?.org_name || meta?.full_name || 'My Organisation';
          const { data: org } = await admin
            .from('organisations')
            .insert({
              name: orgName,
              slug: slugify(orgName) + '-' + Date.now().toString(36),
              owner_id: data.user.id,
            })
            .select()
            .single();

          if (org) {
            await admin.from('profiles').insert({
              id: data.user.id,
              active_organisation_id: org.id,
              organisation_id: org.id,
              full_name: meta?.full_name || null,
              email: data.user.email,
              role: 'owner',
            });
            await admin.from('memberships').insert({
              user_id: data.user.id,
              organisation_id: org.id,
              role: 'owner',
            });
            // Resend is env-driven — bootstrap the email channel so the
            // sequencer can render email-touch steps from day one.
            await bootstrapEmailChannel(admin, org.id, data.user.id);
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
