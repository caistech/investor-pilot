'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Flag, Edit3, Send, Mail, Inbox } from 'lucide-react';
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
}: {
  item: ApprovalItem;
  busy: boolean;
  onApprove: () => void;
  onSkip: () => void;
  onFlag: () => void;
}) {
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
              {channelLabel} · scheduled {new Date(item.scheduled_for).toLocaleString()}
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
        {item.rendered_subject && (
          <p className="text-sm">
            <span className="text-dark-500">Subject: </span>
            <span className="font-medium">{item.rendered_subject}</span>
          </p>
        )}
        <pre className="text-sm whitespace-pre-wrap mt-2 text-dark-200 font-sans">
          {item.rendered_body}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-end">
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
          disabled={busy}
          className="btn-secondary flex items-center gap-2 text-sm opacity-50 cursor-not-allowed"
          title="Edit support coming in Sprint 1 polish"
        >
          <Edit3 className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={onApprove}
          disabled={busy || hasBlockingFlags}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          {hasBlockingFlags ? 'Blocked' : 'Approve & send'}
        </button>
      </div>
    </div>
  );
}
