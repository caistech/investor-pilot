'use client';

import { useState } from 'react';
import { Send, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  vertical: string | null;
  compliance_mode: string;
}

interface LiveStep {
  id: string;
  template_id: string;
  template_name: string;
  step_index: number;
  status: string;
  scheduled_for: string;
}

interface Props {
  partnerId: string;
  templates: Template[];
  liveSteps: LiveStep[];
  recommendedTemplateId: string | null;
  networkDistance: string | null;
}

export default function AssignSequence({
  partnerId,
  templates,
  liveSteps,
  recommendedTemplateId,
  networkDistance,
}: Props) {
  const [selected, setSelected] = useState<string>(recommendedTemplateId || templates[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function assign() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/sequences/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: partnerId, template_id: selected }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to assign sequence');
        return;
      }
      setSuccess(`Assigned to "${json.template_name}" — ${json.sequence_step_ids.length} steps queued.`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  if (liveSteps.length > 0) {
    const grouped = liveSteps.reduce<Record<string, LiveStep[]>>((acc, s) => {
      acc[s.template_name] = acc[s.template_name] || [];
      acc[s.template_name].push(s);
      return acc;
    }, {});
    return (
      <div className="card">
        <h4 className="mb-2">Sequence</h4>
        {Object.entries(grouped).map(([name, steps]) => (
          <div key={name} className="mb-3 last:mb-0">
            <p className="text-sm font-medium">{name}</p>
            <ul className="mt-1 space-y-1 text-xs text-dark-400">
              {steps
                .sort((a, b) => a.step_index - b.step_index)
                .map(s => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="font-mono">#{s.step_index}</span>
                    <span className="capitalize">{s.status.replace(/_/g, ' ')}</span>
                    <span className="text-dark-600">
                      {new Date(s.scheduled_for).toLocaleDateString()}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="card">
        <h4 className="mb-2">Sequence</h4>
        <p className="text-dark-500 text-sm">
          No active sequence templates. Seed one via /api/sequences/seed.
        </p>
      </div>
    );
  }

  const recommendedName = templates.find(t => t.id === recommendedTemplateId)?.name;
  const tierLabel = networkDistance === '1st'
    ? '1st-degree connection'
    : networkDistance === '2nd'
    ? '2nd-degree (mutual)'
    : networkDistance === 'cold'
    ? 'cold'
    : null;

  return (
    <div className="card">
      <h4 className="mb-2">Assign to sequence</h4>
      {tierLabel && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded ${
            networkDistance === '1st'
              ? 'bg-corp-green-500/20 text-corp-green-400'
              : networkDistance === '2nd'
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-dark-700 text-dark-400'
          }`}>
            {tierLabel}
          </span>
          {recommendedName && (
            <span className="text-dark-500">→ recommended: <span className="text-dark-300">{recommendedName}</span></span>
          )}
        </div>
      )}
      <p className="text-dark-500 text-xs mb-3">
        Materialises steps as pending. The cron worker renders and queues each step for
        approval at its scheduled time.
      </p>
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        disabled={busy}
        className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm mb-3"
      >
        {templates.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        onClick={assign}
        disabled={busy || !selected}
        className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
      >
        <Send className="w-4 h-4" />
        {busy ? 'Assigning…' : 'Assign sequence'}
      </button>
      {error && (
        <div className="mt-3 flex items-start gap-2 text-red-400 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mt-3 flex items-start gap-2 text-corp-green-400 text-xs">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}
    </div>
  );
}
