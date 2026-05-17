import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { TemplateStepEditor } from '@/components/settings/template-step-editor';
import { GenerateSequenceButton } from '@/components/settings/generate-sequence-button';
import { TemplateControls } from '@/components/settings/template-controls';

export const dynamic = 'force-dynamic';

interface TemplateStep {
  step_index: number;
  channel: string;
  template_key: string;
  delay_days: number;
  description?: string;
  subject?: string | null;
  body?: string | null;
  is_warm?: boolean;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  vertical: string | null;
  is_active: boolean;
  steps: TemplateStep[];
}

export default async function TemplatesSettingsPage() {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .single();

  const { data: templates } = await supabase
    .from('sequence_templates')
    .select('id, name, description, vertical, is_active, steps')
    .eq('organisation_id', profile?.organisation_id || '')
    .order('created_at', { ascending: true });

  const rows = (templates ?? []) as TemplateRow[];

  return (
    <div>
      <Link href="/settings" className="text-dark-400 hover:text-white text-sm flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to settings
      </Link>

      <div className="flex items-start justify-between gap-4 mb-2">
        <h1>Sequence templates</h1>
        {rows.length > 0 && <GenerateSequenceButton variant="secondary" label="Regenerate from product" confirmBeforeRun />}
      </div>
      <p className="text-dark-400 mb-8 max-w-3xl">
        Each template is a multi-step outreach sequence (LinkedIn connect → DM → email follow-ups).
        Edit a step&apos;s subject and body below — changes flow into the next render of that step
        (existing queued messages are not retro-edited; use Re-render Approvals if you need that).
      </p>

      {rows.length === 0 && (
        <div className="card border-corp-green-500/20 bg-corp-green-500/5">
          <h4 className="mb-2">No sequence yet — generate one from your product</h4>
          <p className="text-dark-300 text-sm mb-4 max-w-2xl">
            Click below to auto-generate a 6-step sequence (LinkedIn connect → DM → email cold-touch →
            two follow-ups → closing email) tailored to your product&apos;s pitch and ICP. Takes ~10 seconds.
            You can edit any step here afterwards.
          </p>
          <GenerateSequenceButton variant="primary" label="Generate sequence from product" />
          <p className="text-dark-500 text-xs mt-3">
            Requires an active product in <Link href="/products" className="underline">/products</Link> with a pitch,
            plus sender identity set in <Link href="/settings" className="underline">/settings</Link>.
          </p>
        </div>
      )}

      <div className="space-y-8 max-w-4xl">
        {rows.map((tpl) => (
          <div key={tpl.id}>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <h3>{tpl.name}</h3>
              {tpl.is_active ? (
                <span className="badge-green">Active</span>
              ) : (
                <span className="badge-amber">Inactive</span>
              )}
              {tpl.vertical && <code className="text-dark-500 text-xs">{tpl.vertical}</code>}
              <div className="ml-auto">
                <TemplateControls
                  templateId={tpl.id}
                  templateName={tpl.name}
                  isActive={tpl.is_active}
                />
              </div>
            </div>
            {tpl.description && (
              <p className="text-dark-400 text-sm mb-4">{tpl.description}</p>
            )}
            <div>
              {(tpl.steps ?? []).map((step) => (
                <TemplateStepEditor
                  key={`${tpl.id}-${step.step_index}`}
                  templateId={tpl.id}
                  stepIndex={step.step_index}
                  templateKey={step.template_key}
                  channel={step.channel}
                  isWarm={step.is_warm === true}
                  initialSubject={step.subject ?? null}
                  initialBody={step.body ?? ''}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
