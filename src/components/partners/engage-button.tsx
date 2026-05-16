'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake, Loader2, X } from 'lucide-react';

/**
 * Mark a prospect as having engaged with a value offer (pilot, brief,
 * intro, positive reply). Distinct from replied (any inbound) and
 * meeting_booked (post-conversation). Pulls them into the
 * "Warm engaged" filter tab on Prospects.
 *
 * Operator workflow: prospect accepted the pilot → operator clicks
 * "Mark engaged" on the detail page → picks an engagement type +
 * optional note → row appears in the Warm engaged queue with a
 * different cadence (nurture, not pitch).
 */
export function EngageButton({
  partnerId,
  partnerName,
  engagedAt,
  engagementType,
  engagementNote,
}: {
  partnerId: string;
  partnerName: string;
  engagedAt: string | null;
  engagementType: string | null;
  engagementNote: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(engagementType || 'pilot_started');
  const [note, setNote] = useState(engagementNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${partnerId}/engage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagement_type: type, engagement_note: note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `${res.status} ${res.statusText}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm('Clear the engagement marker on this prospect?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${partnerId}/engage`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `${res.status} ${res.statusText}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Already engaged → show the status block + Clear option.
  if (engagedAt && !open) {
    return (
      <div className="card border-purple-500/30 bg-purple-500/5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Handshake className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-medium text-purple-300">Warm engaged</h3>
          </div>
          <button
            onClick={clear}
            disabled={busy}
            className="text-xs text-dark-500 hover:text-white inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            Clear
          </button>
        </div>
        <p className="text-xs text-dark-400 mb-2">
          {partnerName.split(/—| at /)[0]} accepted a value offer on <b suppressHydrationWarning>{new Date(engagedAt).toLocaleDateString()}</b>
          {engagementType ? <> · type <b>{engagementType}</b></> : ''}.
        </p>
        {engagementNote && (
          <pre className="text-xs whitespace-pre-wrap text-dark-300 font-sans bg-dark-800 rounded p-2 border border-dark-700">
            {engagementNote}
          </pre>
        )}
        <p className="text-xs text-dark-500 mt-2 italic">
          Visible in the &ldquo;Warm engaged&rdquo; filter on Prospects. Follow-up cadence is nurture, not pitch.
        </p>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  // Not engaged yet, not in form mode → show the trigger.
  if (!engagedAt && !open) {
    return (
      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Handshake className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-medium">Mark as warm engaged</h3>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="text-xs text-purple-400 hover:text-purple-300 underline underline-offset-2"
          >
            Mark engaged
          </button>
        </div>
        <p className="text-xs text-dark-500">
          Use when the prospect accepts a value offer — pilot, brief, intro, positive reply.
          Pulls them into the &ldquo;Warm engaged&rdquo; queue on Prospects with a different cadence.
        </p>
      </div>
    );
  }

  // Form mode.
  return (
    <div className="card border-purple-500/30 bg-purple-500/5">
      <div className="flex items-center gap-2 mb-3">
        <Handshake className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-purple-300">Mark as warm engaged</h3>
      </div>
      <label className="block text-xs text-dark-400 mb-1">What did they engage with?</label>
      <select
        value={type}
        onChange={e => setType(e.target.value)}
        disabled={busy}
        className="w-full bg-dark-800 border border-dark-700 rounded px-2 py-1 text-sm text-dark-200 mb-3 focus:border-purple-500 focus:outline-none"
      >
        <option value="pilot_started">Pilot / trial started</option>
        <option value="brief_downloaded">Brief / one-pager downloaded</option>
        <option value="deck_requested">Deck or data room requested</option>
        <option value="reply_positive">Positive reply (interested, not yet a meeting)</option>
        <option value="intro_made">Warm intro made (we connected them with someone)</option>
        <option value="manual">Manual flag (other)</option>
      </select>
      <label className="block text-xs text-dark-400 mb-1">Context note (optional)</label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        disabled={busy}
        rows={3}
        placeholder='e.g. "Took the pilot for their PortCo Acme — kickoff scheduled Tuesday."'
        className="w-full bg-dark-800 border border-dark-700 rounded p-2 text-sm text-dark-200 font-sans focus:border-purple-500 focus:outline-none resize-y mb-3"
      />
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => { setOpen(false); setError(null); }}
          disabled={busy}
          className="btn-secondary text-sm py-1 px-3"
        >
          Cancel
        </button>
        <button
          onClick={mark}
          disabled={busy}
          className="btn-primary text-sm py-1 px-3 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Handshake className="w-3 h-3" />}
          Mark engaged
        </button>
      </div>
    </div>
  );
}
