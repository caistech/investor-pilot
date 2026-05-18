import Sidebar from '@/components/layout/sidebar';
import { PageGuide } from '@/components/layout/page-guide';
import { SetupBanner } from '@/components/layout/setup-banner';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils';

/**
 * Backstop: if the user has no org at all (rare — should be handled by
 * /auth/callback), create one with them as owner. Sets both
 * active_organisation_id + organisation_id and inserts a memberships row
 * so the multi-org refactor (migration 029) has the right data layer
 * from the start.
 */
async function ensureOrgAndProfile() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.active_organisation_id) return;

  const admin = createServiceClient();
  const meta = user.user_metadata;
  const orgName = meta?.org_name || meta?.full_name || 'My Organisation';

  const { data: org } = await admin
    .from('organisations')
    .insert({
      name: orgName,
      slug: slugify(orgName) + '-' + Date.now().toString(36),
      owner_id: user.id,
    })
    .select()
    .single();

  if (!org) return;

  if (!profile) {
    await admin.from('profiles').insert({
      id: user.id,
      active_organisation_id: org.id,
      organisation_id: org.id,
      full_name: meta?.full_name || null,
      email: user.email,
      role: 'owner',
    });
  } else {
    await admin
      .from('profiles')
      .update({ active_organisation_id: org.id })
      .eq('id', user.id);
  }

  await admin
    .from('memberships')
    .insert({
      user_id: user.id,
      organisation_id: org.id,
      role: 'owner',
    });
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureOrgAndProfile();

  return (
    <div className="min-h-screen bg-dark-950">
      <Sidebar />
      <main className="lg:ml-64 p-4 sm:p-6 lg:p-8 overflow-auto">
        <SetupBanner />
        <PageGuide />
        {children}
      </main>
    </div>
  );
}
