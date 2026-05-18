import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/**
 * Inner layout for /org/[slug]/* routes. Middleware already verifies the
 * caller is a member of the org named in the URL — this layout is a
 * defensive double-check so any direct page render outside the middleware
 * path (RSC streaming, prefetches) still gets blocked if membership
 * is missing.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createServiceClient();
  const { data: org } = await admin
    .from('organisations')
    .select('id')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!org) redirect('/dashboard');

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', org.id)
    .maybeSingle();

  if (!membership) redirect('/dashboard');

  return <>{children}</>;
}
