'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Power, PowerOff, Trash2, Loader2 } from 'lucide-react';

interface Props {
  templateId: string;
  templateName: string;
  isActive: boolean;
}

/**
 * Per-template controls on /settings/templates. Two actions:
 *   - Toggle is_active (cosmetic + functional: inactive templates skip
 *     assign-batch's pool, so new prospects won't land on them)
 *   - Delete (server blocks the delete if any non-terminal sequence_step
 *     still references the template — operator has to deactivate +
 *     reset prospects' sequences first)
 *
 * Shipped 2026-05-17 when an operator accumulated 9 active LingoPure
 * templates (each Generate / Regenerate was inserting instead of
 * upserting) with no way to clean them up.
 */
export function TemplateControls({ templateId, templateName, isActive }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setBusy('toggle');
    setError(null);
    try {
      const res = await fetch(`/api/sequences/templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      });
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteTemplate() {
    if (!confirm(
      `Delete "${templateName}"?\n\n` +
      `This is permanent. Prospects already assigned to this template won't lose their sent / replied history, but any in-flight queued steps will be blocked. If you have in-flight prospects, deactivate first (then Reset their sequences in /partners) and retry delete after.`,
    )) return;
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/sequences/templates/${templateId}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleActive}
        disabled={busy !== null}
        className={`text-xs px-2.5 py-1 rounded border ${
          isActive
            ? 'text-amber-300 border-amber-500/40 hover:bg-amber-500/10'
            : 'text-corp-green-300 border-corp-green-500/40 hover:bg-corp-green-500/10'
        } disabled:opacity-50`}
        title={isActive
          ? 'Deactivate — new prospects will no longer get this template on Assign Sequence'
          : 'Reactivate — assign-batch will route prospects to this template again'}
      >
        {busy === 'toggle' ? (
          <Loader2 className="w-3 h-3 animate-spin inline" />
        ) : isActive ? (
          <><PowerOff className="w-3 h-3 inline mr-1" />Deactivate</>
        ) : (
          <><Power className="w-3 h-3 inline mr-1" />Reactivate</>
        )}
      </button>
      <button
        onClick={deleteTemplate}
        disabled={busy !== null}
        className="text-xs px-2.5 py-1 rounded border text-red-300 border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
        title="Permanent delete — blocked if any in-flight steps still reference this template"
      >
        {busy === 'delete' ? (
          <Loader2 className="w-3 h-3 animate-spin inline" />
        ) : (
          <><Trash2 className="w-3 h-3 inline mr-1" />Delete</>
        )}
      </button>
      {error && (
        <span className="text-xs text-red-400 ml-2 max-w-md">{error}</span>
      )}
    </div>
  );
}
