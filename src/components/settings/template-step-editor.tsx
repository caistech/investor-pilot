'use client';

import { useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';

interface TemplateStepEditorProps {
  templateId: string;
  stepIndex: number;
  templateKey: string;
  channel: string;
  isWarm: boolean;
  initialSubject: string | null;
  initialBody: string;
}

/**
 * Inline edit for a single step inside a sequence template. Operator can
 * change the subject (email steps) and body (every step). Channel,
 * delay_days, template_key, max_chars, and is_warm are read-only here —
 * changing those requires coordinated migration of in-flight sequence_steps.
 *
 * Variables available in template strings (rendered by the sequencer):
 *   {first_name} {firm} {credit_signal} {credit_signal_lead}
 *   {credit_signal_lead_short} {warm_opener} {project_urls_block}
 *   {sender_name} {sender_role}
 */
export function TemplateStepEditor({
  templateId,
  stepIndex,
  templateKey,
  channel,
  isWarm,
  initialSubject,
  initialBody,
}: TemplateStepEditorProps) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [stepBody, setStepBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showSubject = channel === 'email';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          step_index: stepIndex,
          subject: showSubject ? subject : null,
          body: stepBody,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Save failed');
        return;
      }
      setEditing(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setSubject(initialSubject ?? '');
    setStepBody(initialBody);
    setError(null);
    setEditing(false);
  }

  const channelBadge =
    channel === 'email'
      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      : channel === 'linkedin_dm'
        ? 'bg-corp-green-500/10 text-corp-green-400 border-corp-green-500/20'
        : 'bg-purple-500/10 text-purple-400 border-purple-500/20';

  if (!editing) {
    return (
      <div className="card mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-dark-400 text-sm">Step {stepIndex}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium border ${channelBadge}`}>
              {channel}
            </span>
            {isWarm && <span className="badge-amber text-[10px] uppercase tracking-wide">warm</span>}
            <code className="text-dark-500 text-xs">{templateKey}</code>
          </div>
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>
        {showSubject && (
          <div className="mb-2">
            <p className="text-dark-500 text-xs">Subject</p>
            <p className="text-dark-200 text-sm">{initialSubject || <em className="text-dark-500">(none)</em>}</p>
          </div>
        )}
        <p className="text-dark-500 text-xs mt-2">Body</p>
        <pre className="text-dark-200 text-xs whitespace-pre-wrap bg-dark-900 p-3 rounded max-h-64 overflow-y-auto">
          {initialBody || <em className="text-amber-400">(empty — render will fail)</em>}
        </pre>
      </div>
    );
  }

  return (
    <div className="card mb-3 border-corp-green-500/30">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-dark-400 text-sm">Editing step {stepIndex}</span>
        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium border ${channelBadge}`}>
          {channel}
        </span>
        {isWarm && <span className="badge-amber text-[10px] uppercase tracking-wide">warm</span>}
        <code className="text-dark-500 text-xs">{templateKey}</code>
      </div>

      {showSubject && (
        <div className="mb-3">
          <label className="block text-dark-400 text-xs mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="mb-3">
        <label className="block text-dark-400 text-xs mb-1">
          Body <span className="text-dark-500">(use {'{first_name}'}, {'{credit_signal}'}, {'{sender_name}'}, etc.)</span>
        </label>
        <textarea
          value={stepBody}
          onChange={(e) => setStepBody(e.target.value)}
          rows={14}
          className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-xs font-mono"
        />
      </div>

      {error && <p className="text-red-400 text-sm mb-2">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save step'}
        </button>
        <button onClick={cancel} disabled={saving} className="btn-secondary text-sm flex items-center gap-2">
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}
