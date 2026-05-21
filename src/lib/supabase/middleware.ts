import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

// Slug → organisation_id lookup. Uses the authenticated user's
// supabase client (not the anon key) because RLS on the organisations
// table restricts SELECT to members. The previous implementation
// fetched with the raw anon key + wrapped the result in
// next/cache's unstable_cache; both were broken — unstable_cache
// isn't supported in Edge-runtime middleware (causes
// MIDDLEWARE_INVOCATION_FAILED on cold instances), and the anon-key
// fetch returns [] under the current RLS policies so the lookup
// silently returned null for every authenticated user → "Org not
// found" 404 on /org/[slug]/* navigation. The user-scoped client
// passes RLS for their own memberships, which is what we want here.
async function slugLookup(
  supabase: SupabaseClient,
  slug: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('organisations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Protect dashboard routes (legacy + /org/[slug]/*)
  const isProtectedDashboard =
    path.startsWith('/dashboard') ||
    path.startsWith('/partners') ||
    path.startsWith('/products') ||
    path.startsWith('/sessions') ||
    path.startsWith('/settings') ||
    path.startsWith('/org/');

  if (isProtectedDashboard) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  // Protect API routes — but allow auth callbacks, inbound webhooks,
  // and Vercel cron. Webhooks come from third-party servers (Resend,
  // Unipile) with no Supabase auth cookie; they validate themselves via
  // svix signature (Resend) or shared-secret header (Unipile) inside
  // the route handler. /api/cron/* runs unauthenticated to the cookie
  // layer because Vercel cron sends a Bearer CRON_SECRET header instead
  // — the route handler self-validates that secret before doing any
  // work. Without this allowlist entry the cron has been silently
  // 401-ing for days even when the secret was correct, and any operator
  // trying to trigger /api/cron/sequencer via curl hits the same wall.
  // /api/team/invite/<token> GET is public (the /invite/accept page
  // fetches invitation metadata before the recipient is signed in).
  // The route handler itself rejects POST/DELETE without auth. POST is
  // also protected by the user-email match check inside the handler.
  const isPublicInviteGet =
    request.method === 'GET' &&
    /^\/api\/team\/invite\/[^\/]+$/.test(path);

  if (
    path.startsWith('/api') &&
    !path.startsWith('/api/auth') &&
    !path.startsWith('/api/webhooks') &&
    !path.startsWith('/api/cron') &&
    !isPublicInviteGet
  ) {
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if ((path === '/login' || path === '/signup') && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Legacy dashboard URLs (/dashboard, /partners, /products, etc.) →
  // redirect to /org/<active-slug>/<suffix> so internal bookmarks and
  // external deep-links still work after the routing refactor.
  const legacyDashboardPaths = [
    '/dashboard', '/partners', '/products', '/projects', '/discover',
    '/approvals', '/outreach', '/sequences', '/sessions', '/channels',
    '/settings',
  ];
  const isLegacyDashboard = legacyDashboardPaths.some(
    (p) => path === p || path.startsWith(p + '/'),
  );
  if (isLegacyDashboard && user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organisation_id')
      .eq('id', user.id)
      .maybeSingle();

    let activeOrgId = (profile?.active_organisation_id as string | null | undefined) ?? null;

    // Defensive fallback: when active_organisation_id is null OR the org
    // it points at no longer exists, pick the user's earliest membership
    // and self-heal the profile. Without this, post-login redirect to
    // /dashboard 404s silently because the lookup below requires a valid
    // slug. Bit by this on 2026-05-21 after migration 038 deleted a
    // duplicate org and some profiles were left without a usable
    // active_organisation_id.
    if (!activeOrgId) {
      const { data: anyMembership } = await supabase
        .from('memberships')
        .select('organisation_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      activeOrgId = (anyMembership?.organisation_id as string | undefined) ?? null;
      if (activeOrgId) {
        await supabase
          .from('profiles')
          .update({ active_organisation_id: activeOrgId })
          .eq('id', user.id);
      }
    }

    if (activeOrgId) {
      const { data: org } = await supabase
        .from('organisations')
        .select('slug')
        .eq('id', activeOrgId)
        .maybeSingle();
      if (org?.slug) {
        const url = request.nextUrl.clone();
        url.pathname = `/org/${org.slug}${path}`;
        return NextResponse.redirect(url);
      }
    }
  }

  // Multi-org active-org sync on /org/[slug]/*. Reads the slug, verifies
  // membership, syncs profiles.active_organisation_id so the JWT claim
  // minted on next refresh reflects the URL the user is actually viewing.
  const orgMatch = path.match(/^\/org\/([^\/]+)(\/|$)/);
  if (orgMatch && user) {
    const slug = orgMatch[1];
    const orgId = await slugLookup(supabase, slug);

    if (!orgId) {
      return new NextResponse('Org not found', { status: 404 });
    }

    const { data: membership } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('organisation_id', orgId)
      .maybeSingle();

    if (!membership) {
      return new NextResponse('Not a member of this org', { status: 404 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organisation_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profile && profile.active_organisation_id !== orgId) {
      await supabase
        .from('profiles')
        .update({ active_organisation_id: orgId })
        .eq('id', user.id);

      await supabase.auth.refreshSession();
    }
  }

  return supabaseResponse;
}
