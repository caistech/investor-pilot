import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Workflow, ArrowRight, Clock, Send, Mail } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SequencesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .single();

  if (!profile?.organisation_id) return null;

  const [{ data: templates }, { data: activeSteps }] = await Promise.all([
    supabase
      .from('sequence_templates')
      .select('id, name, vertical, description, compliance_mode, is_active, steps, created_at')
      .eq('organisation_id', profile.organisation_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('sequence_steps')
      .select(`
        id, channel, scheduled_for, status, step_index,
        partners ( id, company_name )
      `)
      .eq('organisation_id', profile.organisation_id)
      .in('status', ['pending', 'awaiting_verification', 'queued_for_approval'])
      .order('scheduled_for', { ascending: true })
      .limit(30),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Sequences</h1>
          <p className="text-dark-400 mt-1">Multi-touch outreach plans and per-prospect step state.</p>
        </div>
      </div>

      {/* Coming-soon notice about full template editing */}
      <div className="card mb-6 border-blue-500/20 bg-blue-500/5">
        <p className="text-sm text-blue-300">
          <span className="font-semibold">Heads-up:</span> sequences are currently auto-generated from
          each product&apos;s pitch + ICP (Products → Generate sequence). You can edit individual step
          copy in <Link href="/settings/templates" className="underline">Settings → Templates</Link>.
          A full sequence builder (add/remove steps, change channels and delays, multiple sequences per
          product) is on the roadmap.
        </p>
      </div>

      {/* Templates */}
      <div className="mb-10">
        <h3 className="mb-4">Templates</h3>
        {!templates || templates.length === 0 ? (
          <div className="card text-center py-12">
            <Workflow className="w-10 h-10 text-dark-500 mx-auto mb-3" />
            <p className="text-dark-400">No sequence templates yet.</p>
            <p className="text-dark-500 text-sm mt-1">
              Visit <Link href="/products" className="text-corp-green-400 underline">Products</Link> and click
              &ldquo;Generate sequence&rdquo; on any active product to auto-create a tailored 6-step sequence.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {templates.map((t) => {
              const steps = Array.isArray(t.steps) ? t.steps : [];
              return (
                <div key={t.id} className="card">
                  <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-dark-500 text-sm">
                        {t.vertical || 'general'} · {t.compliance_mode} · {t.is_active ? 'active' : 'inactive'}
                      </p>
                    </div>
                    <span className="badge-blue">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
                  </div>
                  {t.description && <p className="text-dark-300 text-sm mb-3">{t.description}</p>}
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    {steps.map((s: { channel?: string; delay_days?: number }, idx: number) => (
                      <span key={idx} className="flex items-center gap-1">
                        <StepBadge channel={s.channel || 'unknown'} delay={s.delay_days} />
                        {idx < steps.length - 1 && <ArrowRight className="w-3 h-3 text-dark-500" />}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active steps (in-flight) */}
      <div>
        <h3 className="mb-4">In-flight steps</h3>
        {!activeSteps || activeSteps.length === 0 ? (
          <div className="card text-center py-12">
            <Clock className="w-10 h-10 text-dark-500 mx-auto mb-3" />
            <p className="text-dark-400">No active sequence steps.</p>
            <p className="text-dark-500 text-sm mt-1">
              The sequencer (Phase 2 deliverable) will populate steps once it&apos;s running.
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Prospect</th>
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Channel</th>
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Scheduled</th>
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {activeSteps.map((s: Record<string, unknown>) => {
                  const partner = Array.isArray(s.partners) ? s.partners[0] : s.partners;
                  return (
                  <tr key={s.id as string} className="border-b border-dark-800 last:border-0">
                    <td className="px-6 py-3">
                      {partner ? (
                        <Link href={`/partners/${partner.id}`} className="text-corp-green-400 hover:text-corp-green-300">
                          {partner.company_name}
                        </Link>
                      ) : (
                        <span className="text-dark-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <StepBadge channel={s.channel as string} />
                    </td>
                    <td className="px-6 py-3 text-sm text-dark-300">
                      {new Date(s.scheduled_for as string).toLocaleString()}
                    </td>
                    <td className="px-6 py-3">
                      <span className={statusColor(s.status as string)}>{(s.status as string).replace(/_/g, ' ')}</span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StepBadge({ channel, delay }: { channel: string; delay?: number }) {
  const Icon = channel.startsWith('linkedin') ? Send : channel === 'email' ? Mail : Workflow;
  const label = channel === 'linkedin_connect'
    ? 'Connect'
    : channel === 'linkedin_dm'
    ? 'DM'
    : channel === 'email'
    ? 'Email'
    : channel;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-dark-800 text-sm">
      <Icon className="w-3 h-3" />
      {label}
      {typeof delay === 'number' && <span className="text-dark-500">+{delay}d</span>}
    </span>
  );
}

function statusColor(status: string): string {
  if (status === 'pending') return 'badge-grey';
  if (status === 'queued_for_approval') return 'badge-amber';
  if (status === 'awaiting_verification') return 'badge-blue';
  if (status === 'sent') return 'badge-orange';
  if (status === 'replied') return 'badge-green';
  if (status === 'compliance_blocked') return 'badge-red';
  if (status === 'skipped' || status === 'opted_out') return 'badge-grey';
  return 'badge-grey';
}
