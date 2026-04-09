import { createClient } from '@/lib/supabase/server';

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('*, organisations(*)').single();

  return (
    <div>
      <h1 className="mb-8">Settings</h1>

      <div className="space-y-6 max-w-2xl">
        <div className="card">
          <h4 className="mb-4">Organisation</h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-dark-400">Name</span>
              <span>{(profile?.organisations as Record<string, string>)?.name || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-400">Your role</span>
              <span className="badge-green">{profile?.role}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h4 className="mb-4">Profile</h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-dark-400">Name</span>
              <span>{profile?.full_name || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-400">Email</span>
              <span>{profile?.email || '—'}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h4 className="mb-4">API Connections</h4>
          <p className="text-dark-400 text-sm mb-4">
            API keys are managed via Vercel environment variables. Contact the admin to update.
          </p>
          <div className="space-y-2 text-sm">
            {['Anthropic', 'Hunter', 'Brave Search', 'Resend'].map((service) => (
              <div key={service} className="flex items-center justify-between py-2 border-b border-dark-800 last:border-0">
                <span>{service}</span>
                <span className="badge-green">Configured via env</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-2">
              <span>Gmail MCP</span>
              <span className="badge-amber">OAuth required</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
