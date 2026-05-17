import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { slugify } from '@/lib/utils';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Use service client for org/profile creation (bypasses RLS)
      const admin = createServiceClient();

      // Check if profile exists
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .single();

      if (!profile) {
        const meta = data.user.user_metadata;
        // Teams iteration: when /api/team/invite calls
        // inviteUserByEmail with { data: { organisation_id, role } }, the
        // invitee lands here with org_id in metadata. Join them to the
        // existing org rather than creating a fresh one.
        const invitedOrgId = meta?.organisation_id || meta?.invited_organisation_id;
        const invitedRole = meta?.role || 'member';

        if (invitedOrgId) {
          // Invited member — join existing org, no new org created
          await admin.from('profiles').insert({
            id: data.user.id,
            organisation_id: invitedOrgId,
            full_name: meta?.full_name || null,
            email: data.user.email,
            role: invitedRole === 'admin' || invitedRole === 'owner' ? invitedRole : 'member',
          });
        } else {
          // Fresh signup — create org and make user the owner
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
              organisation_id: org.id,
              full_name: meta?.full_name || null,
              email: data.user.email,
              role: 'owner',
            });
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
