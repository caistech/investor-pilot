'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Flag, Edit3, Send, Mail, Inbox, Save, RotateCw } from 'lucide-react';
import type { ApprovalItem } from './page';

interface Props {
  items: ApprovalItem[];
}

export default function ApprovalsClient({ items: initialItems }: Props) {
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(stepId: string, action: 'approve' | 'skip' | 'flag', payload?: Record<string, unknown>) {
    setBusyId(stepId);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${stepId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Action failed');
        return;
      }
      setItems(items.filter(i => i.step_id !== stepId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  }

  async function regenerate(stepId: string) {
    setBusyId(stepId);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${stepId}/regenerate`, { method: 'POST' });
      const rawBody = await res.text();
      let json: { [k: string]: unknown };
      try { json = JSON.parse(rawBody); } catch {
        setError(`/api/approvals/${stepId}/regenerate returned HTTP ${res.status} non-JSON: ${rawBody.slice(0, 200)}`);
        return;
      }
      if (!res.ok) {
        setError((json.error as string) || `${res.status} ${res.statusText}`);
        return;
      }
      // If the regenerated step is still queued, patch the card with the
      // fresh body. If it went to compliance_blocked / failed (e.g.
      // no_credit_signal again), drop it from the list — the operator
      // should re-enrich evidence and re-render from Prospects.
      if (json.new_status === 'queued_for_approval' && json.rendered_body) {
        setItems(items.map(i => i.step_id === stepId
          ? { ...i,
              rendered_subject: (json.rendered_subject as string | null) ?? i.rendered_subject,
              rendered_body: json.rendered_body as string,
              compliance_check: (json.compliance_check as ApprovalItem['compliance_check']) ?? i.compliance_check,
              personalization_score: (json.personalization_score as number | null) ?? i.personalization_score,
            }
          : i));
      } else {
        setItems(items.filter(i => i.step_id !== stepId));
        setError(
          `Draft regenerated but new status is "${json.new_status}". ` +
          `Likely no_credit_signal — re-enrich this partner's evidence on the Prospects page, then re-render.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(stepId: string, rendered_subject: string | null, rendered_body: string) {
    setBusyId(stepId);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${stepId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rendered_subject, rendered_body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Edit failed');
        return false;
      }
      // Patch the in-place item so the card re-renders with the new body
      // and the new compliance check without a full page reload.
      setItems(items.map(i => i.step_id === stepId
        ? { ...i,
            rendered_subject: json.rendered_subject,
            rendered_body: json.rendered_body,
            compliance_check: json.compliance_check,
          }
        : i));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Approval queue</h1>
          <p className="text-dark-400 mt-1">
            {items.length === 0 ? 'Nothing pending.' : `${items.length} item${items.length === 1 ? '' : 's'} awaiting your approval.`}
          </p>
        </div>
      </div>

      {error && (
        <div className="card border-red-500/50 bg-red-500/10 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card text-center py-16">
          <Inbox className="w-10 h-10 text-dark-500 mx-auto mb-3" />
          <p className="text-dark-400">No messages pending approval.</p>
          <p className="text-dark-500 text-sm mt-1">
            When the sequencer queues a message, it&apos;ll appear here for review before send.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <ApprovalCard
              key={item.step_id}
              item={item}
              busy={busyId === item.step_id}
              onApprove={() => act(item.step_id, 'approve')}
              onSkip={() => act(item.step_id, 'skip')}
              onFlag={() => {
                const reason = prompt('Flag this message — reason?');
                if (reason) act(item.step_id, 'flag', { reason });
              }}
              onSave={(subject, body) => saveEdit(item.step_id, subject, body)}
              onRegenerate={() => regenerate(item.step_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  item,
  busy,
  onApprove,
  onSkip,
  onFlag,
  onSave,
  onRegenerate,
}: {
  item: ApprovalItem;
  busy: boolean;
  onApprove: () => void;
  onSkip: () => void;
  onFlag: () => void;
  onSave: (subject: string | null, body: string) => Promise<boolean>;
  onRegenerate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(item.rendered_subject || '');
  const [editBody, setEditBody] = useState(item.rendered_body);

  function startEdit() {
    setEditSubject(item.rendered_subject || '');
    setEditBody(item.rendered_body);
    setEditing(true);
  }
  async function commitEdit() {
    const ok = await onSave(
      item.rendered_subject !== null ? editSubject : null,
      editBody,
    );
    if (ok) setEditing(false);
  }
  function cancelEdit() {
    setEditSubject(item.rendered_subject || '');
    setEditBody(item.rendered_body);
    setEditing(false);
  }
  const Icon = item.channel.startsWith('linkedin') ? Send : Mail;
  const channelLabel = item.channel === 'linkedin_connect' ? 'LinkedIn connect' : item.channel === 'linkedin_dm' ? 'LinkedIn DM' : 'Email';
  const compliance = item.compliance_check;
  const hasBlockingFlags = compliance?.blocked || false;
  const hasFlags = (compliance?.flags?.length || 0) > 0;

  let complianceBadge;
  if (hasBlockingFlags) {
    complianceBadge = (
      <span className="badge-red inline-flex items-center gap-1">
        <XCircle className="w-3 h-3" />
        Blocked
      </span>
    );
  } else if (hasFlags) {
    complianceBadge = (
      <span className="badge-amber inline-flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Flagged
      </span>
    );
  } else if (compliance) {
    complianceBadge = (
      <span className="badge-green inline-flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Clear
      </span>
    );
  } else {
    complianceBadge = <span className="badge-grey">No check</span>;
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Icon className="w-5 h-5 text-corp-green-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{item.partner_name}</p>
              {item.partner_score !== null && (
                <span className="badge-blue">{item.partner_score.toFixed(1)}/10</span>
              )}
              {item.personalization_score !== null && (
                <span className="badge-purple">P {item.personalization_score}/10</span>
              )}
            </div>
            <p className="text-dark-500 text-sm">
              {channelLabel} · scheduled <span suppressHydrationWarning>{new Date(item.scheduled_for).toLocaleString()}</span>
            </p>
          </div>
        </div>
        {complianceBadge}
      </div>

      {compliance?.flags && compliance.flags.length > 0 && (
        <div className="mb-4 space-y-1">
          {compliance.flags.map((f, idx) => (
            <div
              key={idx}
              className={`text-sm px-3 py-2 rounded-lg border ${
                f.level === 'block'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              <span className="font-medium">{f.level === 'block' ? '✗' : '⚠'}</span>{' '}
              {f.reason}
              {f.match && <span className="text-dark-400"> — &ldquo;{f.match}&rdquo;</span>}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-dark-700 pt-4 mb-4">
        {item.rendered_subject !== null && (
          editing ? (
            <input
              type="text"
              value={editSubject}
              onChange={e => setEditSubject(e.target.value)}
              disabled={busy}
              placeholder="Subject"
              className="w-full bg-dark-800 border border-corp-green-500/40 rounded px-2 py-1 text-sm font-medium mb-2 focus:border-corp-green-500 focus:outline-none"
            />
          ) : (
            <p className="text-sm">
              <span className="text-dark-500">Subject: </span>
              <span className="font-medium">{item.rendered_subject}</span>
            </p>
          )
        )}
        {editing ? (
          <textarea
            value={editBody}
            onChange={e => setEditBody(e.target.value)}
            disabled={busy}
            rows={Math.max(6, editBody.split('\n').length + 1)}
            className="w-full bg-dark-800 border border-corp-green-500/40 rounded p-2 text-sm text-dark-200 font-sans focus:border-corp-green-500 focus:outline-none resize-y"
          />
        ) : (
          <pre className="text-sm whitespace-pre-wrap mt-2 text-dark-200 font-sans">
            {item.rendered_body}
          </pre>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-end">
        {editing ? (
          <>
            <button
              onClick={cancelEdit}
              disabled={busy}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={commitEdit}
              disabled={busy || !editBody.trim()}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Save edit
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onFlag}
              disabled={busy}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Flag className="w-4 h-4" />
              Flag
            </button>
            <button
              onClick={onSkip}
              disabled={busy}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <XCircle className="w-4 h-4" />
              Skip
            </button>
            <button
              onClick={startEdit}
              disabled={busy}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Edit3 className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={onRegenerate}
              disabled={busy}
              className="btn-secondary flex items-center gap-2 text-sm"
              title="Drop this draft and re-render using the current prompts + extractors. Useful for refreshing drafts produced before a fix landed."
            >
              <RotateCw className="w-4 h-4" />
              Regenerate
            </button>
            <button
              onClick={onApprove}
              disabled={busy || hasBlockingFlags}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {hasBlockingFlags ? 'Blocked' : 'Approve & send'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
