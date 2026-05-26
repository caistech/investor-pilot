import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/**
 * /dashboard — post-auth landing resolver.
 *
 * Login, signup, password-reset and /auth/callback all send the user to
 * `/dashboard`, but every app surface lives under `/org/[slug]/*`. This page
 * resolves the user's active organisation and forwards them to its dashboard.
 *
 * Without it, `/dashboard` 404'd and every user was stranded behind the front
 * door (naive-tester Tier-2, 2026-05-26) — the org layout even falls back to
 * `/dashboard` on a missing membership, so the route has to exist and resolve.
 *
 * This page sits inside the (dashboard) group, whose layout runs
 * `ensureOrgAndProfile()` to completion before this renders, so by the time we
 * read `active_organisation_id` it is guaranteed set in the normal flow.
 */
export default async function DashboardResolver() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createServiceClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.active_organisation_id) {
    const { data: org } = await admin
      .from('organisations')
      .select('slug')
      .eq('id', profile.active_organisation_id)
      .maybeSingle();
    if (org?.slug) redirect(`/org/${org.slug}/dashboard`);
  }

  // No resolvable org even after the layout backstop — extremely rare. Send to
  // the marketing home rather than loop back through /login.
  redirect('/');
}
