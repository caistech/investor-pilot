'use client';

import { useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';

interface SenderFormProps {
  initialSenderName: string | null;
  initialSenderRole: string | null;
  initialSignatureBlock: string | null;
  initialSenderLinkedinUrl: string | null;
  initialSenderBioOneLiner: string | null;
  initialSenderCalendarUrl: string | null;
}

/**
 * Inline edit card for the organisation's sender identity.
 *
 * sender_name and sender_role are interpolated into every outbound LinkedIn
 * DM and email body via the {sender_name} / {sender_role} placeholders in
 * the sequencer templates. Editing here changes the signature on every
 * subsequent send (does NOT retro-edit messages already queued — operator
 * can use Re-render Approvals if they want that).
 */
export function SenderForm({
  initialSenderName,
  initialSenderRole,
  initialSignatureBlock,
  initialSenderLinkedinUrl,
  initialSenderBioOneLiner,
  initialSenderCalendarUrl,
}: SenderFormProps) {
  const [editing, setEditing] = useState(false);
  const [senderName, setSenderName] = useState(initialSenderName ?? '');
  const [senderRole, setSenderRole] = useState(initialSenderRole ?? '');
  const [signatureBlock, setSignatureBlock] = useState(initialSignatureBlock ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(initialSenderLinkedinUrl ?? '');
  const [bioOneLiner, setBioOneLiner] = useState(initialSenderBioOneLiner ?? '');
  const [calendarUrl, setCalendarUrl] = useState(initialSenderCalendarUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/sender', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_name: senderName.trim(),
          sender_role: senderRole.trim(),
          signature_block: signatureBlock.trim() || null,
          sender_linkedin_url: linkedinUrl.trim() || null,
          sender_bio_one_liner: bioOneLiner.trim() || null,
          sender_calendar_url: calendarUrl.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Save failed');
        return;
      }
      setEditing(false);
      // Force a server refresh so the displayed values match the DB.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setSenderName(initialSenderName ?? '');
    setSenderRole(initialSenderRole ?? '');
    setSignatureBlock(initialSignatureBlock ?? '');
    setLinkedinUrl(initialSenderLinkedinUrl ?? '');
    setBioOneLiner(initialSenderBioOneLiner ?? '');
    setCalendarUrl(initialSenderCalendarUrl ?? '');
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h4>Sender identity</h4>
          <button onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Edit
          </button>
        </div>
        <p className="text-dark-400 text-sm mb-4">
          Used as <code className="text-dark-300">{'{sender_name}'}</code> and{' '}
          <code className="text-dark-300">{'{sender_role}'}</code> in every outbound LinkedIn DM
          and email body. Editing here changes the signature on every subsequent send.
        </p>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-dark-400">Sender name</span>
            <span>{initialSenderName || <em className="text-amber-400">not set</em>}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Sender role</span>
            <span className="text-right max-w-md">
              {initialSenderRole || <em className="text-amber-400">not set</em>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">LinkedIn URL</span>
            <span className="text-right max-w-md truncate">
              {initialSenderLinkedinUrl
                ? <a href={initialSenderLinkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">{initialSenderLinkedinUrl}</a>
                : <em className="text-amber-400">not set — recipients will Google you</em>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Bio one-liner</span>
            <span className="text-right max-w-md">
              {initialSenderBioOneLiner || <em className="text-dark-500">optional — richer who-I-am framing</em>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Calendar booking URL</span>
            <span className="text-right max-w-md truncate">
              {initialSenderCalendarUrl
                ? <a href={initialSenderCalendarUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">{initialSenderCalendarUrl}</a>
                : <em className="text-amber-400">not set — recipients can&apos;t self-book</em>}
            </span>
          </div>
          {initialSignatureBlock && (
            <div className="pt-3 border-t border-dark-800">
              <p className="text-dark-400 mb-2">Signature block</p>
              <pre className="text-dark-300 text-xs whitespace-pre-wrap bg-dark-900 p-3 rounded">
                {initialSignatureBlock}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h4 className="mb-4">Edit sender identity</h4>
      <div className="space-y-4 text-sm">
        <div>
          <label className="block text-dark-400 mb-1">Sender name</label>
          <input
            type="text"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="e.g. Jane Smith"
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-dark-400 mb-1">Sender role</label>
          <input
            type="text"
            value={senderRole}
            onChange={(e) => setSenderRole(e.target.value)}
            placeholder="e.g. Managing Director, Acme Capital"
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-dark-400 mb-1">
            LinkedIn URL <span className="text-dark-500">— recipients always look you up before responding</span>
          </label>
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/your-handle"
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-dark-500 mt-1">Included in cold outreach so recipients can verify you in one click instead of Googling. Trust signal + basic courtesy.</p>
        </div>
        <div>
          <label className="block text-dark-400 mb-1">
            Bio one-liner <span className="text-dark-500">(optional)</span>
          </label>
          <input
            type="text"
            value={bioOneLiner}
            onChange={(e) => setBioOneLiner(e.target.value)}
            placeholder="e.g. Technical Director at LingoPure, ex-Founder Institute Country Director"
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-dark-500 mt-1">Richer who-I-am context for the first cold email. The renderer uses this verbatim where it fits.</p>
        </div>
        <div>
          <label className="block text-dark-400 mb-1">
            Calendar booking URL <span className="text-dark-500">— self-serve the ask</span>
          </label>
          <input
            type="url"
            value={calendarUrl}
            onChange={(e) => setCalendarUrl(e.target.value)}
            placeholder="https://cal.com/your-handle or https://calendly.com/..."
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-dark-500 mt-1">Substituted into the ASK at the end of cold messages. Lets recipients self-book without an email volley — beats &ldquo;Does Thursday or Friday work?&rdquo;.</p>
        </div>
        <div>
          <label className="block text-dark-400 mb-1">
            Signature block <span className="text-dark-500">(optional, multi-line)</span>
          </label>
          <textarea
            value={signatureBlock}
            onChange={(e) => setSignatureBlock(e.target.value)}
            placeholder="e.g.&#10;Acme Capital&#10;www.acme.com&#10;+61 400 000 000"
            rows={4}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || !senderName.trim() || !senderRole.trim()}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancel} disabled={saving} className="btn-secondary text-sm flex items-center gap-2">
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
