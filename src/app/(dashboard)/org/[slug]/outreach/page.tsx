// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  Mail, CheckCircle, AlertTriangle, Clock, XCircle,
  ChevronDown, ChevronRight, ExternalLink, RefreshCw,
} from 'lucide-react';
import { SetupGate } from '@/components/layout/setup-gate';

interface OutreachEntry {
  id: string;
  partner_id: string;
  email_type: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  sent_at: string | null;
  reply_received_at: string | null;
  follow_up_due_at: string | null;
  created_at: string;
  partners: {
    company_name: string;
    domain: string;
    status: string;
  };
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'sent':
      return <span className="badge-blue"><Mail className="w-3 h-3 mr-1" />Sent</span>;
    case 'replied':
      return <span className="badge-green"><CheckCircle className="w-3 h-3 mr-1" />Replied</span>;
    case 'bounced':
      return <span className="badge-red"><XCircle className="w-3 h-3 mr-1" />Bounced</span>;
    case 'failed':
      return <span className="badge-red"><AlertTriangle className="w-3 h-3 mr-1" />Failed</span>;
    case 'queued':
      return <span className="badge-amber"><Clock className="w-3 h-3 mr-1" />Queued</span>;
    default:
      return <span className="badge-grey">{status}</span>;
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OutreachPage() {
  const [entries, setEntries] = useState<OutreachEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const supabase = createClient();

  async function loadOutreach() {
    setLoading(true);
    // Wait for auth state to be ready before querying
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organisation_id')
      .eq('id', user.id)
      .single();

    if (!profile?.active_organisation_id) {
      setLoading(false);
      return;
    }
    setOrgId(profile.active_organisation_id);

    const { data } = await supabase
      .from('outreach_log')
      .select(`
        id, partner_id, email_type, to_email, subject, body, status,
        sent_at, reply_received_at, follow_up_due_at, created_at,
        partners!inner(company_name, domain, status)
      `)
      .eq('organisation_id', profile.active_organisation_id)
      .order('created_at', { ascending: false });

    if (data) setEntries(data as unknown as OutreachEntry[]);
    setLoading(false);
  }

  useEffect(() => { loadOutreach(); }, []);

  async function markStatus(outreachId: string, partnerId: string, status: 'replied' | 'bounced') {
    setUpdating(outreachId);
    try {
      const res = await fetch('/api/pipeline/track', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_id: outreachId, status, partner_id: partnerId }),
      });
      if (res.ok) await loadOutreach();
    } finally {
      setUpdating(null);
    }
  }

  const filtered = filter === 'all' ? entries : entries.filter(e => e.status === filter);
  const counts = {
    all: entries.length,
    sent: entries.filter(e => e.status === 'sent').length,
    replied: entries.filter(e => e.status === 'replied').length,
    bounced: entries.filter(e => e.status === 'bounced').length,
  };
  const overdue = entries.filter(e =>
    e.status === 'sent' && e.follow_up_due_at && new Date(e.follow_up_due_at) < new Date()
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-dark-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1>Outreach</h1>
          <p className="text-dark-400 mt-1">{entries.length} emails tracked</p>
        </div>
        <button onClick={loadOutreach} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <SetupGate
        required={['sequenceConfigured', 'channelConnected']}
        pageName="Outreach"
        pageVerb="track sent messages and replies"
      >

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="text-2xl font-bold">{counts.all}</div>
          <div className="text-dark-500 text-sm">Total Sent</div>
        </div>
        <div className="card">
          <div className="text-2xl font-bold text-green-400">{counts.replied}</div>
          <div className="text-dark-500 text-sm">Replied</div>
        </div>
        <div className="card">
          <div className="text-2xl font-bold text-amber-400">{overdue.length}</div>
          <div className="text-dark-500 text-sm">Follow-up Due</div>
        </div>
        <div className="card">
          <div className="text-2xl font-bold text-red-400">{counts.bounced}</div>
          <div className="text-dark-500 text-sm">Bounced</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'sent', 'replied', 'bounced'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'tab-active' : 'tab'}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1 text-dark-500">({counts[f] || 0})</span>
          </button>
        ))}
      </div>

      {/* Outreach list */}
      {filtered.length === 0 ? (
        <div className="card text-center py-16">
          <Mail className="w-10 h-10 text-dark-600 mx-auto mb-3" />
          <p className="text-dark-400 text-lg">No outreach emails yet</p>
          <p className="text-dark-500 mt-2">Run a session to discover partners and draft outreach.</p>
          <Link href="/sessions" className="btn-primary inline-block mt-4">Start a Session</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => {
            const isExpanded = expandedId === entry.id;
            const isOverdue = entry.status === 'sent' && entry.follow_up_due_at
              && new Date(entry.follow_up_due_at) < new Date();

            return (
              <div key={entry.id} className={`card ${isOverdue ? 'border-amber-500/30' : ''}`}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="flex items-center gap-3 w-full text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-dark-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-white truncate">
                        {entry.partners?.company_name || 'Unknown'}
                      </span>
                      <StatusBadge status={entry.status} />
                      {isOverdue && (
                        <span className="badge-amber text-xs">
                          <Clock className="w-3 h-3 mr-1" />Follow-up due
                        </span>
                      )}
                    </div>
                    <div className="text-dark-400 text-sm truncate mt-0.5">
                      {entry.to_email} &mdash; {entry.subject}
                    </div>
                  </div>
                  <div className="text-dark-600 text-xs shrink-0">
                    {timeAgo(entry.sent_at || entry.created_at)}
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-dark-800 space-y-3">
                    {/* Email preview */}
                    <div className="bg-dark-800 rounded-lg p-4">
                      <div className="text-dark-400 text-xs mb-1">
                        To: <span className="text-white">{entry.to_email}</span>
                      </div>
                      <div className="text-dark-400 text-xs mb-2">
                        Subject: <span className="text-white">{entry.subject}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-dark-300 text-sm mt-3">
                        {entry.body}
                      </div>
                    </div>

                    {/* Meta info */}
                    <div className="flex items-center gap-4 text-xs text-dark-500">
                      <span>Type: {entry.email_type.replace(/_/g, ' ')}</span>
                      {entry.sent_at && (
                        <span>Sent: {new Date(entry.sent_at).toLocaleDateString('en-AU', {
                          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}</span>
                      )}
                      {entry.follow_up_due_at && entry.status === 'sent' && (
                        <span>Follow-up due: {new Date(entry.follow_up_due_at).toLocaleDateString('en-AU', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}</span>
                      )}
                      {entry.reply_received_at && (
                        <span>Replied: {new Date(entry.reply_received_at).toLocaleDateString('en-AU', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/partners/${entry.partner_id}`}
                        className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3 h-3" /> View Partner
                      </Link>
                      {entry.status === 'sent' && (
                        <>
                          <button
                            onClick={() => markStatus(entry.id, entry.partner_id, 'replied')}
                            disabled={updating === entry.id}
                            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
                          >
                            <CheckCircle className="w-3 h-3" /> Mark Replied
                          </button>
                          <button
                            onClick={() => markStatus(entry.id, entry.partner_id, 'bounced')}
                            disabled={updating === entry.id}
                            className="text-xs py-1.5 px-3 rounded text-red-400 border border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5"
                          >
                            <XCircle className="w-3 h-3" /> Mark Bounced
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      </SetupGate>
    </div>
  );
}
