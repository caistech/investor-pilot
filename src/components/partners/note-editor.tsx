'use client';

import { useState } from 'react';
import { Loader2, NotebookPen, Save, X } from 'lucide-react';

/**
 * Operator-injected note for a single partner. Persists to
 * partners.last_session_notes and is read by the renderer's
 * extractCreditSignal alongside the auto-collected evidence — so the
 * next draft uses the operator's private context as ground truth.
 *
 * Use case: a prospect surfaced with thin Brave / LinkedIn evidence,
 * but the operator personally met them at a conference and has context
 * the system can't otherwise see. Paste it here, regenerate the draft
 * from Approvals, and the message reflects that ground truth.
 */
export function NoteEditor({
  partnerId,
  partnerName,
  initialNote,
}: {
  partnerId: string;
  partnerName: string;
  initialNote: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote || '');
  const [saved, setSaved] = useState<string | null>(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${partnerId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `${res.status} ${res.statusText}`);
        return;
      }
      setSaved(note);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-medium">Operator note · ground truth for the renderer</h3>
        </div>
        {!open && (
          <button
            onClick={() => { setOpen(true); setNote(saved || ''); }}
            className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
          >
            {saved ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
      <p className="text-xs text-dark-500 mb-3">
        Paste private context about {partnerName.split(/\s|—/)[0] || 'this prospect'} that the public discovery sources couldn&apos;t surface
        — a conference conversation, a mutual intro, a thesis they shared off-record. The renderer reads this as evidence on the next draft,
        so the message reflects what you actually know rather than what Brave / LinkedIn happen to see.
      </p>

      {open ? (
        <>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={busy}
            rows={Math.max(4, note.split('\n').length + 1)}
            placeholder={`e.g. "Met at SaaStr 2025 — they mentioned actively scouting SEA EdTech deals under $5M, particularly anything with enterprise sales motion. Co-investor with Reach Capital on two prior deals."`}
            className="w-full bg-dark-800 border border-amber-500/30 rounded p-2 text-sm text-dark-200 font-sans focus:border-amber-500 focus:outline-none resize-y"
          />
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2 justify-end mt-3">
            <button
              onClick={() => { setOpen(false); setNote(saved || ''); setError(null); }}
              disabled={busy}
              className="btn-secondary text-sm py-1 px-3 inline-flex items-center gap-1.5"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !note.trim()}
              className="btn-primary text-sm py-1 px-3 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save note
            </button>
          </div>
        </>
      ) : saved ? (
        <pre className="text-sm whitespace-pre-wrap text-dark-300 font-sans bg-dark-800 rounded p-3 border border-dark-700">
          {saved}
        </pre>
      ) : (
        <p className="text-sm text-dark-500 italic">
          No note yet. Click <span className="text-amber-400">Add</span> to inject private context that the renderer will use as evidence on the next draft.
        </p>
      )}
    </div>
  );
}
