import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { TemplateStepEditor } from '@/components/settings/template-step-editor';

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

      <h1 className="mb-2">Sequence templates</h1>
      <p className="text-dark-400 mb-8 max-w-3xl">
        Each template is a multi-step outreach sequence. Edit a step&apos;s subject and body
        below — changes flow into the next render of that step (existing queued messages are
        not retro-edited; use Re-render Approvals if you need that).
      </p>

      {rows.length === 0 && (
        <div className="card">
          <p className="text-dark-400 text-sm">
            No templates yet. Visit <code>/api/sequences/seed</code> in your browser to seed
            the default lender sequences.
          </p>
        </div>
      )}

      <div className="space-y-8 max-w-4xl">
        {rows.map((tpl) => (
          <div key={tpl.id}>
            <div className="flex items-center gap-3 mb-3">
              <h3>{tpl.name}</h3>
              {tpl.is_active ? (
                <span className="badge-green">Active</span>
              ) : (
                <span className="badge-amber">Inactive</span>
              )}
              {tpl.vertical && <code className="text-dark-500 text-xs">{tpl.vertical}</code>}
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
