'use client';

/**
 * PartnerCommunications — unified comms thread for a single partner.
 *
 * Surfaces THREE data sources in one place so the operator doesn't have to
 * leave the contact page to manage the relationship:
 *
 *   1. Pending approvals (outbound_messages.status='queued_for_approval')
 *      — full Approve / Skip / Flag controls inline, same API as /approvals.
 *   2. Sent history (outbound_messages where sent_at IS NOT NULL, plus the
 *      legacy outreach_log email path).
 *   3. Inbound replies (inbound_messages from Resend/Unipile webhooks).
 *
 * The global /approvals page still exists as a compilation across all partners.
 * This is the per-contact lens.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Flag,
  Inbox,
  Mail,
  MessageSquare,
  Send,
  XCircle,
} from 'lucide-react';

export interface PendingApproval {
  step_id: string;
  message_id: string;
  channel: string;
  scheduled_for: string;
  rendered_subject: string | null;
  rendered_body: string;
  compliance_check: {
    pass: boolean;
    blocked: boolean;
    flags: Array<{ level: string; reason: string; match: string }>;
  } | null;
  personalization_score: number | null;
}

export interface TimelineEvent {
  id: string;
  kind: 'outbound' | 'inbound' | 'legacy_email';
  channel: string;
  timestamp: string;
  subject: string | null;
  body: string;
  meta: {
    status?: string;
    send_error?: string | null;
    channel_message_id?: string | null;
    classification?: { intent?: string; requires_human?: boolean } | null;
  };
}

interface Props {
  pendingApprovals: PendingApproval[];
  timeline: TimelineEvent[];
}

export default function PartnerCommunications({ pendingApprovals, timeline }: Props) {
  const [pending, setPending] = useState(pendingApprovals);
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
      setPending(p => p.filter(i => i.step_id !== stepId));
      // Refresh the page so the timeline includes the just-actioned message.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0 && timeline.length === 0) {
    return (
      <div className="card">
        <h4 className="mb-2">Communications</h4>
        <div className="text-center py-8">
          <MessageSquare className="w-8 h-8 text-dark-600 mx-auto mb-2" />
          <p className="text-dark-500 text-sm">No messages yet. Assign a sequence to start outreach.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h4>Communications</h4>
        <span className="text-dark-500 text-xs">
          {pending.length} pending · {timeline.length} in history
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wide text-corp-green-400 mb-2">Pending approval</p>
          <div className="space-y-3">
            {pending.map(item => (
              <PendingCard
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
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-dark-500 mb-2">History</p>
          <ul className="space-y-3">
            {timeline.map(ev => (
              <TimelineRow key={`${ev.kind}-${ev.id}`} ev={ev} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PendingCard({
  item,
  busy,
  onApprove,
  onSkip,
  onFlag,
}: {
  item: PendingApproval;
  busy: boolean;
  onApprove: () => void;
  onSkip: () => void;
  onFlag: () => void;
}) {
  const Icon = item.channel.startsWith('linkedin') ? Send : Mail;
  const channelLabel =
    item.channel === 'linkedin_connect'
      ? 'LinkedIn connect'
      : item.channel === 'linkedin_dm'
      ? 'LinkedIn DM'
      : 'Email';
  const compliance = item.compliance_check;
  const hasBlockingFlags = compliance?.blocked || false;
  const hasFlags = (compliance?.flags?.length || 0) > 0;

  return (
    <div className="border border-corp-green-500/30 bg-corp-green-500/5 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-corp-green-400" />
          <span className="text-sm font-medium">{channelLabel}</span>
          {item.personalization_score !== null && (
            <span className="badge-purple text-[10px]">P {item.personalization_score}/10</span>
          )}
        </div>
        {hasBlockingFlags ? (
          <span className="badge-red text-[10px] inline-flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Blocked
          </span>
        ) : hasFlags ? (
          <span className="badge-amber text-[10px] inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Flagged
          </span>
        ) : (
          <span className="badge-green text-[10px] inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Clear
          </span>
        )}
      </div>

      {compliance?.flags && compliance.flags.length > 0 && (
        <div className="mb-3 space-y-1">
          {compliance.flags.map((f, idx) => (
            <div
              key={idx}
              className={`text-xs px-2 py-1 rounded border ${
                f.level === 'block'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              <span className="font-medium">{f.level === 'block' ? '✗' : '⚠'}</span> {f.reason}
              {f.match && <span className="text-dark-400"> — &ldquo;{f.match}&rdquo;</span>}
            </div>
          ))}
        </div>
      )}

      {item.rendered_subject && (
        <p className="text-xs text-dark-400 mb-1">
          <span className="text-dark-500">Subject: </span>
          {item.rendered_subject}
        </p>
      )}
      <pre className="text-xs whitespace-pre-wrap text-dark-200 font-sans mb-3">{item.rendered_body}</pre>

      <div className="flex flex-wrap items-center gap-2 justify-end">
        <button onClick={onFlag} disabled={busy} className="btn-secondary flex items-center gap-1.5 text-xs">
          <Flag className="w-3.5 h-3.5" /> Flag
        </button>
        <button onClick={onSkip} disabled={busy} className="btn-secondary flex items-center gap-1.5 text-xs">
          <XCircle className="w-3.5 h-3.5" /> Skip
        </button>
        <button
          disabled
          className="btn-secondary flex items-center gap-1.5 text-xs opacity-50 cursor-not-allowed"
          title="Edit support coming in Sprint 1 polish"
        >
          <Edit3 className="w-3.5 h-3.5" /> Edit
        </button>
        <button
          onClick={onApprove}
          disabled={busy || hasBlockingFlags}
          className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {hasBlockingFlags ? 'Blocked' : 'Approve & send'}
        </button>
      </div>
    </div>
  );
}

function TimelineRow({ ev }: { ev: TimelineEvent }) {
  const direction = ev.kind === 'inbound' ? 'in' : 'out';
  const channelLabel =
    ev.channel === 'linkedin_connect'
      ? 'LinkedIn connect'
      : ev.channel === 'linkedin_dm'
      ? 'LinkedIn DM'
      : ev.channel === 'linkedin_connect_accept'
      ? 'LinkedIn connect accepted'
      : 'Email';
  const Icon = ev.channel.startsWith('linkedin') ? Send : ev.kind === 'inbound' ? Inbox : Mail;

  const error = ev.meta.send_error;
  const status = ev.meta.status;
  const intent = ev.meta.classification?.intent;
  const requiresHuman = ev.meta.classification?.requires_human;

  return (
    <li
      className={`pl-3 border-l-2 ${
        direction === 'in'
          ? 'border-blue-500/40'
          : error
          ? 'border-red-500/40'
          : status === 'sent'
          ? 'border-corp-green-500/40'
          : 'border-dark-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon
          className={`w-3.5 h-3.5 ${
            direction === 'in' ? 'text-blue-400' : error ? 'text-red-400' : 'text-corp-green-400'
          }`}
        />
        <span className="text-xs font-medium">
          {direction === 'in' ? 'Received' : 'Sent'} · {channelLabel}
        </span>
        <span className="text-dark-600 text-[10px]" suppressHydrationWarning>{new Date(ev.timestamp).toLocaleString()}</span>
        {error && <span className="badge-red text-[10px]">Send failed</span>}
        {status === 'replied' && <span className="badge-blue text-[10px]">Replied</span>}
        {status === 'bounced' && <span className="badge-red text-[10px]">Bounced</span>}
        {intent && <span className="badge-purple text-[10px]">{intent}</span>}
        {requiresHuman && <span className="badge-amber text-[10px]">Needs human</span>}
      </div>
      {ev.subject && (
        <p className="text-xs text-dark-400 mb-0.5">
          <span className="text-dark-500">Subject: </span>
          {ev.subject}
        </p>
      )}
      <pre className="text-xs whitespace-pre-wrap text-dark-300 font-sans">{ev.body}</pre>
      {error && (
        <p className="text-xs text-red-300 mt-1">
          <span className="text-dark-500">Error: </span>
          {error}
        </p>
      )}
    </li>
  );
}
