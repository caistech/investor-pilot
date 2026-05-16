import Sidebar from '@/components/layout/sidebar';
import { PageGuide } from '@/components/layout/page-guide';
import { ElevenLabsWidget } from '@/components/layout/elevenlabs-widget';
import { SetupBanner } from '@/components/layout/setup-banner';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils';

async function ensureOrgAndProfile() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .single();

  if (profile?.organisation_id) return;

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
      organisation_id: org.id,
      full_name: meta?.full_name || null,
      email: user.email,
      role: 'owner',
    });
  } else {
    await admin.from('profiles').update({ organisation_id: org.id }).eq('id', user.id);
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureOrgAndProfile();

  return (
    <div className="flex min-h-screen bg-dark-950">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">
        <SetupBanner />
        <PageGuide />
        {children}
      </main>
      <ElevenLabsWidget />
    </div>
  );
}
