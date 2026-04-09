import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  // Protect dashboard routes
  if (path.startsWith('/dashboard') || path.startsWith('/partners') ||
      path.startsWith('/products') || path.startsWith('/sessions') ||
      path.startsWith('/settings')) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  // Protect API routes (except auth callback)
  if (path.startsWith('/api') && !path.startsWith('/api/auth')) {
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Redirect logged-in users from auth pages to dashboard
  if ((path === '/login' || path === '/signup') && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
