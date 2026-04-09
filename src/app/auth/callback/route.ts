import { createClient } from '@/lib/supabase/server';
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
      // Check if profile exists, create org + profile if not
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .single();

      if (!profile) {
        const meta = data.user.user_metadata;
        const orgName = meta?.org_name || meta?.full_name || 'My Organisation';

        // Create organisation
        const { data: org } = await supabase
          .from('organisations')
          .insert({
            name: orgName,
            slug: slugify(orgName) + '-' + Date.now().toString(36),
            owner_id: data.user.id,
          })
          .select()
          .single();

        if (org) {
          // Create profile
          await supabase.from('profiles').insert({
            id: data.user.id,
            organisation_id: org.id,
            full_name: meta?.full_name || null,
            email: data.user.email,
            role: 'owner',
          });
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
