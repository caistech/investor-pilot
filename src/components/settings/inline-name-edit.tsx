'use client';

import { useState } from 'react';
import { Pencil, Save, X, Loader2 } from 'lucide-react';

/**
 * Tiny inline-edit row for a single name field — used by the
 * Organisation Name and Profile Name rows on the Settings page so we
 * don't ship two near-identical components.
 */
export function InlineNameEdit({
  label,
  initialValue,
  endpoint,
  field = 'name',
  placeholder,
  maxLength = 200,
}: {
  label: string;
  initialValue: string | null;
  endpoint: string;
  field?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue ?? '');
  const [saved, setSaved] = useState(initialValue ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!value.trim()) {
      setError(`${label} cannot be empty`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || `${res.status} ${res.statusText}`);
        return;
      }
      setSaved(value.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setValue(saved);
    setError(null);
    setEditing(false);
  }

  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-dark-400 shrink-0">{label}</span>
      {editing ? (
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            disabled={busy}
            maxLength={maxLength}
            placeholder={placeholder}
            className="flex-1 bg-dark-900 border border-dark-700 rounded px-2 py-1 text-sm text-right focus:border-corp-green-500 focus:outline-none"
          />
          <button onClick={save} disabled={busy} className="text-corp-green-400 hover:text-corp-green-300" title="Save">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
          <button onClick={cancel} disabled={busy} className="text-dark-500 hover:text-white" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{saved || <em className="text-dark-500">not set</em>}</span>
          <button
            onClick={() => { setValue(saved); setEditing(true); }}
            className="text-dark-500 hover:text-white shrink-0"
            title={`Edit ${label.toLowerCase()}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {error && <p className="text-red-400 text-xs ml-auto">{error}</p>}
    </div>
  );
}
