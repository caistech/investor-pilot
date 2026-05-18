import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';

const slugLookup = unstable_cache(
  async (slug: string, anonKey: string, supabaseUrl: string): Promise<string | null> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/organisations?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  },
  ['org-slug-to-id'],
  { revalidate: 300 },
);

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

  // Protect API routes — but allow auth callbacks AND inbound webhooks.
  // Webhooks come from third-party servers (Resend, Unipile) with no
  // Supabase auth cookie; they validate themselves via svix signature
  // (Resend) or shared-secret header (Unipile) inside the route handler.
  if (
    path.startsWith('/api') &&
    !path.startsWith('/api/auth') &&
    !path.startsWith('/api/webhooks')
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

  // Multi-org active-org sync. Only fires on /org/[slug]/* routes (which
  // don't exist until Lane C lands; this is the gate that catches them
  // when they do). Reads the slug, verifies membership, syncs
  // profiles.active_organisation_id so the JWT claim minted on next
  // refresh reflects the URL the user is actually viewing.
  const orgMatch = path.match(/^\/org\/([^\/]+)(\/|$)/);
  if (orgMatch && user) {
    const slug = orgMatch[1];
    const orgId = await slugLookup(
      slug,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
    );

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
