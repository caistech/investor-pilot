import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { ShieldAlert, ShieldCheck, Plug, FileText } from 'lucide-react';
import { SenderForm } from '@/components/settings/sender-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('*, organisations(*)').single();

  // Channels summary
  const { count: activeChannels } = await supabase
    .from('client_channels')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', profile?.organisation_id || '')
    .eq('status', 'active');
  const { count: pausedChannels } = await supabase
    .from('client_channels')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', profile?.organisation_id || '')
    .eq('status', 'paused');

  return (
    <div>
      <h1 className="mb-8">Settings</h1>

      <div className="space-y-6 max-w-3xl">
        {/* Organisation */}
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

        {/* Sender identity (used in every outbound DM + email) */}
        <SenderForm
          initialSenderName={(profile?.organisations as Record<string, string | null>)?.sender_name ?? null}
          initialSenderRole={(profile?.organisations as Record<string, string | null>)?.sender_role ?? null}
          initialSignatureBlock={(profile?.organisations as Record<string, string | null>)?.signature_block ?? null}
        />

        {/* Profile */}
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

        {/* Channels summary + kill switch entry */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h4>Channels & safety</h4>
            <Link href="/channels" className="btn-secondary text-sm flex items-center gap-2">
              <Plug className="w-4 h-4" />
              Manage channels
            </Link>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-dark-400">Active channels</span>
              <span className="badge-green">{activeChannels || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-dark-400">Paused channels</span>
              <span className={pausedChannels ? 'badge-amber' : 'badge-grey'}>{pausedChannels || 0}</span>
            </div>
            <div className="pt-3 border-t border-dark-800">
              <p className="text-dark-300 mb-2 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                Kill switch
              </p>
              <p className="text-dark-500 text-xs mb-3">
                Pause every active channel in one click. Useful when a campaign needs an immediate stop or a
                Unipile-level event is suspected. The kill switch lives on the Channels page.
              </p>
              <Link href="/channels" className="btn-danger inline-flex items-center gap-2 text-sm">
                <ShieldAlert className="w-4 h-4" />
                Go to kill switch
              </Link>
            </div>
          </div>
        </div>

        {/* Compliance mode */}
        <div className="card">
          <h4 className="mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-corp-green-400" />
            Compliance mode
          </h4>
          <p className="text-dark-400 text-sm mb-4">
            Determines which pre-send filter rule set applies to outbound messages.
            Rule sets are defined in <code className="text-dark-300">src/lib/compliance/rules.ts</code>.
          </p>
          <div className="space-y-2 text-sm">
            {[
              { id: 'finance_au_senior_debt', label: 'Finance AU — Senior debt (current)', active: true },
              { id: 'finance_au_wholesale', label: 'Finance AU — Wholesale (deferred)', active: false },
              { id: 'finance_us', label: 'Finance US (reserved)', active: false },
              { id: 'standard', label: 'Standard / no industry-specific rules', active: false },
            ].map(mode => (
              <div
                key={mode.id}
                className={`p-3 rounded-lg border flex items-center justify-between ${
                  mode.active ? 'border-corp-green-500/40 bg-corp-green-500/5' : 'border-dark-700 bg-dark-900'
                }`}
              >
                <span>{mode.label}</span>
                {mode.active && <span className="badge-green">Active</span>}
              </div>
            ))}
          </div>
          <p className="text-dark-500 text-xs mt-3">
            Mode switching UI is a Sprint 1 deliverable — currently mode is set per
            sequence_templates.compliance_mode. Counsel can update specific rules without
            code change once rule content is moved to JSON config.
          </p>
        </div>

        {/* API services */}
        <div className="card">
          <h4 className="mb-4">API services</h4>
          <p className="text-dark-400 text-sm mb-4">
            API keys are managed via environment variables. Contact admin to update.
          </p>
          <div className="space-y-2 text-sm">
            {['Anthropic / OpenRouter', 'Hunter.io', 'Brave Search', 'Resend', 'Unipile'].map((service) => (
              <div key={service} className="flex items-center justify-between py-2 border-b border-dark-800 last:border-0">
                <span>{service}</span>
                <span className="badge-green">Configured via env</span>
              </div>
            ))}
          </div>
        </div>

        {/* Documentation */}
        <div className="card">
          <h4 className="mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-corp-green-400" />
            Documentation
          </h4>
          <p className="text-dark-400 text-sm mb-4">
            Operating documentation lives in <code className="text-dark-300">docs/sprint-0/</code>.
          </p>
          <div className="space-y-1.5 text-sm">
            <p>· Sprint 0 README — orchestration + status</p>
            <p>· Senior Debt Brief v3 — source of truth for offering + ICP</p>
            <p>· File 09 — operational ICP + scoring rubric</p>
            <p>· File 02 — funnel math + dashboard spec</p>
            <p>· Files 06 + 07 — LinkedIn + email message templates</p>
            <p>· File 10 — SPV term sheets</p>
          </div>
        </div>
      </div>
    </div>
  );
}
