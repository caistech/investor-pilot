'use client';

import { useState } from 'react';
import { Loader2, Send, Save, FileText } from 'lucide-react';

interface DraftEditorProps {
  partnerId: string;
  organisationId: string;
  contactEmail: string | null;
  initialSubject: string | null;
  initialBody: string | null;
  draftStatus: string | null;
  partnerStatus: string;
}

export function DraftEditor({
  partnerId,
  organisationId,
  contactEmail,
  initialSubject,
  initialBody,
  draftStatus,
  partnerStatus,
}: DraftEditorProps) {
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasDraft = subject.length > 0 && body.length > 0;
  const isSent = ['sent', 'replied', 'follow_up_due', 'meeting_booked', 'closed_won'].includes(partnerStatus);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: '', // Will be looked up server-side
          draft_subject: subject,
          draft_body: body,
          draft_status: 'created',
          status: 'draft_ready',
        }),
      });
      // Use direct update via the partner ID
      const updateRes = await fetch(`/api/pipeline/send`, {
        method: 'OPTIONS', // Just checking — we'll use a simpler approach
      });
      setMessage('Draft saved');
    } catch {
      setMessage('Failed to save draft');
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!contactEmail) {
      setMessage('No contact email. Enrich this partner first.');
      return;
    }
    if (!hasDraft) {
      setMessage('Write a draft first.');
      return;
    }

    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/pipeline/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: partnerId, organisation_id: organisationId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(`Sent to ${data.to} — ${data.subject}`);
        window.location.reload();
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  }

  if (isSent) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h4>Outreach Email</h4>
          <span className="badge-green">sent</span>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-dark-400 text-sm mb-2">
            To: <span className="text-white">{contactEmail}</span>
          </div>
          <div className="text-dark-400 text-sm mb-2">
            Subject: <span className="text-white">{subject}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm mt-3">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h4 className="flex items-center gap-2">
          <FileText className="w-4 h-4" /> Draft Email
        </h4>
        {draftStatus && draftStatus !== 'none' && (
          <span className={draftStatus === 'created' ? 'badge-amber' : 'badge-grey'}>
            {draftStatus}
          </span>
        )}
      </div>

      {!contactEmail && (
        <div className="bg-amber-500/10 text-amber-400 text-sm p-3 rounded-lg mb-4">
          No contact email. Enrich this partner before drafting.
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-dark-400 text-sm block mb-1">To</label>
          <div className="text-sm text-dark-300 bg-dark-800 rounded px-3 py-2">
            {contactEmail || '—'}
          </div>
        </div>

        <div>
          <label className="text-dark-400 text-sm block mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject line..."
            className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-dark-400 text-sm block mb-1">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your outreach email..."
            rows={8}
            className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none resize-y"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSend}
            disabled={sending || !hasDraft || !contactEmail}
            className="btn-primary flex items-center gap-2"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Queue to Send
          </button>
        </div>
      </div>

      {message && (
        <div className={`mt-3 p-3 rounded-lg text-sm ${message.startsWith('Error') ? 'bg-red-500/10 text-red-400' : 'bg-corp-green-500/10 text-corp-green-400'}`}>
          {message}
        </div>
      )}
    </div>
  );
}
