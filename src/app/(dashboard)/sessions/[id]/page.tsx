'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle, Circle, Loader2, AlertTriangle,
  Search, Filter, BarChart3, Globe, UserSearch, Mail, Send,
  Target, FileText, Play, Pause, ChevronDown, ChevronRight,
  XCircle, Trash2, Edit3,
} from 'lucide-react';
import type { SessionMode } from '@/lib/types';

function InlineDraftCard({
  companyName, domain, contactName, contactEmail, initialSubject, initialBody,
}: {
  companyName: string; domain: string; contactName: string;
  contactEmail: string; initialSubject: string; initialBody: string;
}) {
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      // Look up the partner by domain to get the ID
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { data: partner } = await supabase
        .from('partners')
        .select('id, organisation_id')
        .ilike('domain', `%${domain}%`)
        .limit(1)
        .single();

      if (!partner) {
        setError('Partner not found in database');
        return;
      }

      const res = await fetch('/api/pipeline/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: partner.id, organisation_id: partner.organisation_id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Send failed');
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="text-sm">
        <div className="flex items-center gap-2 text-corp-green-400 mb-2">
          <CheckCircle className="w-4 h-4" />
          <span className="font-medium">Sent to {contactName} at {companyName}</span>
        </div>
        <div className="text-dark-500">Subject: {subject}</div>
      </div>
    );
  }

  return (
    <div className="text-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-white font-medium">{companyName}</span>
          <span className="text-dark-400 ml-2">→ {contactName}</span>
          <span className="text-dark-500 ml-2">{contactEmail}</span>
        </div>
        <button onClick={() => setEditing(!editing)} className="text-dark-400 hover:text-white">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-1.5 text-sm focus:border-corp-green-500 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none resize-y"
          />
        </div>
      ) : (
        <div className="bg-dark-800 rounded-lg p-3">
          <div className="text-dark-400 text-xs mb-1">Subject: <span className="text-white">{subject}</span></div>
          <div className="whitespace-pre-wrap text-dark-300 text-xs mt-2">{body}</div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSend}
          disabled={sending || !contactEmail}
          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Approve & Send
        </button>
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1.5 px-3">
            Edit
          </button>
        )}
        {editing && (
          <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5 px-3">
            Done Editing
          </button>
        )}
      </div>

      {error && <div className="text-red-400 text-xs">{error}</div>}
    </div>
  );
}

interface SessionData {
  id: string;
  product_id: string;
  mode: SessionMode;
  status: string;
  current_stage: string;
  partners_added: number;
  partners_updated: number;
  contacts_found: number;
  drafts_filed: number;
}

interface EventCard {
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

export default function SessionDetailPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [events, setEvents] = useState<EventCard[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState('');
  const [collapsedEvents, setCollapsedEvents] = useState<Set<string>>(new Set());
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const supabase = createClient();

  const scrollToBottom = useCallback(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load session and events from DB
  useEffect(() => {
    async function load() {
      const { data: sess } = await supabase
        .from('agent_sessions')
        .select('*')
        .eq('id', params.id)
        .single();

      if (sess) setSession(sess as SessionData);

      const { data: evts } = await supabase
        .from('session_events')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });

      if (evts) {
        setEvents(evts as EventCard[]);
        // Check if last event is an approval request (resume state)
        const lastEvt = evts[evts.length - 1];
        if (lastEvt?.event_type === 'approval_required') {
          setAwaitingApproval(true);
          setApprovalMessage((lastEvt.event_data as Record<string, unknown>).message as string || 'Review and approve to continue.');
        }
      }
    }
    load();
  }, [params.id, supabase]);

  useEffect(() => {
    scrollToBottom();
  }, [events, scrollToBottom]);

  // Refresh session data from DB
  async function refreshSession() {
    const { data: sess } = await supabase
      .from('agent_sessions')
      .select('*')
      .eq('id', params.id)
      .single();
    if (sess) setSession(sess as SessionData);

    const { data: evts } = await supabase
      .from('session_events')
      .select('*')
      .eq('session_id', params.id)
      .order('created_at', { ascending: true });
    if (evts) setEvents(evts as EventCard[]);
  }

  // Core SSE reader — connects to /api/agent/run and processes events
  async function startAgent(action: 'start' | 'continue' | 'approve') {
    setStreaming(true);
    setError(null);
    setAwaitingApproval(false);
    setAgentMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: params.id, action }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        setError(`Agent failed: ${res.status} ${body}`);
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop()!;

        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(chunk.slice(6));

            if (event.type === 'event') {
              // Add event to feed (it's already saved to DB by the server)
              setEvents((prev) => [...prev, {
                id: `live-${Date.now()}-${Math.random()}`,
                event_type: event.event_type,
                event_data: event.event_data,
                created_at: new Date().toISOString(),
              }]);
            } else if (event.type === 'approval_required') {
              setAwaitingApproval(true);
              setApprovalMessage(event.message || 'Review and approve to continue.');
              setStreaming(false);
              await refreshSession();
              return;
            } else if (event.type === 'continue') {
              // Auto-continue to next chunk
              setStreaming(false);
              await refreshSession();
              setTimeout(() => startAgent('continue'), 500);
              return;
            } else if (event.type === 'pipeline_complete') {
              setStreaming(false);
              await refreshSession();
              return;
            } else if (event.type === 'agent_message') {
              setAgentMessage(event.content);
            } else if (event.type === 'error') {
              setError(event.message);
            }
          } catch {
            // Ignore malformed SSE chunks
          }
        }
      }

      // Stream ended normally
      setStreaming(false);
      await refreshSession();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Connection lost');
      setStreaming(false);
      // Auto-reconnect from DB on connection drop
      await refreshSession();
    }
  }

  function approveAndContinue() {
    setAwaitingApproval(false);
    startAgent('approve');
  }

  function toggleEvent(id: string) {
    setCollapsedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSession() {
    if (!session) return;
    await fetch(`/api/sessions?id=${session.id}`, { method: 'DELETE' });
    window.location.href = '/sessions';
  }

  // --- Event rendering (preserved from original) ---

  function formatEventType(type: string): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function getEventIcon(type: string) {
    if (type.includes('error')) return <XCircle className="w-4 h-4 text-red-400" />;
    if (type.includes('categor')) return <Search className="w-4 h-4 text-blue-400" />;
    if (type.includes('discover') || type.includes('search')) return <Globe className="w-4 h-4 text-purple-400" />;
    if (type.includes('screen')) return <Filter className="w-4 h-4 text-amber-400" />;
    if (type.includes('scor')) return <BarChart3 className="w-4 h-4 text-green-400" />;
    if (type.includes('research') || type.includes('browse')) return <Globe className="w-4 h-4 text-cyan-400" />;
    if (type.includes('contact')) return <UserSearch className="w-4 h-4 text-blue-400" />;
    if (type.includes('motion')) return <Target className="w-4 h-4 text-purple-400" />;
    if (type.includes('draft')) return <FileText className="w-4 h-4 text-amber-400" />;
    if (type.includes('approval')) return <Pause className="w-4 h-4 text-amber-400" />;
    return <Circle className="w-4 h-4 text-dark-400" />;
  }

  function renderEventContent(event: EventCard) {
    const d = event.event_data;

    switch (event.event_type) {
      case 'categories_generated': {
        const cats = d.categories as Array<unknown> | undefined;
        return (
          <div>
            <p className="text-dark-300 mb-2">{d.count as number || cats?.length || 0} categories identified</p>
            <div className="space-y-1">
              {cats?.map((cat, i) => {
                // Handle both {category, rationale} objects and plain strings
                const name = typeof cat === 'string' ? cat : (cat as Record<string, string>).category || (cat as Record<string, string>).name || '';
                const rationale = typeof cat === 'string' ? '' : (cat as Record<string, string>).rationale || (cat as Record<string, string>).reason || '';
                return (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-dark-500 font-mono w-5">{i + 1}.</span>
                    <div>
                      <span className="text-white font-medium">{name}</span>
                      {rationale && <span className="text-dark-400 ml-2">{rationale}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      case 'category_searched':
        return (
          <div>
            <p className="text-dark-300 mb-1">
              <span className="text-white font-medium">{d.category as string}</span>
              {' — '}{d.count as number} candidates found
            </p>
            <div className="space-y-1">
              {(d.candidates as Array<{ company_name: string; domain: string }>)?.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-dark-500 font-mono w-5">{i + 1}.</span>
                  <span className="text-white">{c.company_name}</span>
                  <span className="text-dark-500">({c.domain})</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'candidates_screened':
        return (
          <p className="text-dark-300">
            <span className="text-green-400 font-medium">{d.passed as number} passed</span>
            {' / '}
            <span className="text-red-400 font-medium">{d.screened_out as number} screened out</span>
          </p>
        );

      case 'candidate_screened_out':
        return (
          <div className="flex items-center gap-2 text-sm">
            <XCircle className="w-3 h-3 text-red-400" />
            <span className="text-dark-300">{d.company_name as string}</span>
            <span className="text-dark-500">— {d.reason as string}</span>
          </div>
        );

      case 'partner_scored':
        return (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-white font-medium">{d.company_name as string}</span>
            <span className="text-corp-green-400 font-mono font-bold">
              {(d.weighted_score as number)?.toFixed(1)}
            </span>
          </div>
        );

      case 'company_researched':
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white">{d.company_name as string}</span>
            <span className="text-dark-500">{d.results_found as number} results found</span>
          </div>
        );

      case 'contact_found':
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white">{d.company_name as string}</span>
            {d.contact_name ? <span className="text-dark-300">→ {String(d.contact_name)}</span> : null}
            <span className={
              d.email_status === 'verified' ? 'badge-green text-xs' :
              d.email_status === 'probable' ? 'badge-amber text-xs' :
              'badge-red text-xs'
            }>
              {d.email_status as string}
            </span>
            {d.email_confidence ? (
              <span className="text-dark-500 text-xs">{Number(d.email_confidence)}%</span>
            ) : null}
          </div>
        );

      case 'motion_selected':
        return (
          <div className="text-sm">
            <span className="text-white">{d.company_name as string}</span>
            <span className="text-dark-400 ml-2">→ {d.partnership_motion as string}</span>
          </div>
        );

      case 'draft_created':
        return (
          <InlineDraftCard
            companyName={(d.company_name as string) || 'Unknown'}
            domain={(d.domain as string) || ''}
            contactName={(d.contact_name as string) || ''}
            contactEmail={(d.contact_email as string) || ''}
            initialSubject={(d.subject as string) || ''}
            initialBody={(d.body as string) || ''}
          />
        );

      case 'stage_error':
      case 'agent_error':
        return (
          <div className="text-sm text-red-400">
            {d.error as string}
          </div>
        );

      case 'approval_required':
        return (
          <div className="text-sm text-amber-400">
            {d.message as string}
          </div>
        );

      case 'stage_progress':
        return (
          <div className="text-sm text-dark-300">
            {d.message as string}
          </div>
        );

      default:
        return (
          <pre className="text-xs text-dark-400 overflow-x-auto">
            {JSON.stringify(d, null, 2)}
          </pre>
        );
    }
  }

  // --- Render ---

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-dark-400" />
      </div>
    );
  }

  const isCompleted = session.status === 'completed';
  const canStart = !streaming && !awaitingApproval && !isCompleted && events.length === 0;
  const canResume = !streaming && !awaitingApproval && !isCompleted && events.length > 0
    && session.status === 'active' && !events.some((e) => e.event_type === 'approval_required' && e === events[events.length - 1]);

  return (
    <div>
      {/* Header */}
      <Link href="/sessions" className="flex items-center gap-2 text-dark-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Sessions
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agent Session</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={session.mode === 'guided' ? 'badge-blue' : 'badge-purple'}>
              {session.mode === 'guided' ? (
                <><Pause className="w-3 h-3 mr-1" /> Guided</>
              ) : (
                <><Play className="w-3 h-3 mr-1" /> Batch</>
              )}
            </span>
            <span className={
              session.status === 'active' ? 'badge-green' :
              session.status === 'completed' ? 'badge-grey' : 'badge-amber'
            }>
              {session.status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold">{session.partners_added}</div>
              <div className="text-dark-500">Partners</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{session.contacts_found}</div>
              <div className="text-dark-500">Contacts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{session.drafts_filed}</div>
              <div className="text-dark-500">Drafts</div>
            </div>
          </div>
          <button
            onClick={deleteSession}
            className="p-2 text-dark-600 hover:text-red-400 transition-colors"
            title="Delete session"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Event Feed */}
      <div className="space-y-4">
        {/* Start button */}
        {canStart && (
          <div className="card text-center py-12">
            <Play className="w-10 h-10 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400 mb-4">Ready to start the partnership discovery agent.</p>
            <button onClick={() => startAgent('start')} className="btn-primary">
              Start Agent
            </button>
          </div>
        )}

        {/* Event cards */}
        {events.filter((e) => e.event_type !== 'approval_required').map((event) => (
          <div key={event.id} className="card">
            <button
              onClick={() => toggleEvent(event.id)}
              className="flex items-center gap-3 w-full text-left"
            >
              {getEventIcon(event.event_type)}
              <span className="font-medium text-sm flex-1">{formatEventType(event.event_type)}</span>
              <span className="text-dark-600 text-xs">
                {new Date(event.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {collapsedEvents.has(event.id) ? (
                <ChevronRight className="w-4 h-4 text-dark-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-dark-500" />
              )}
            </button>
            {!collapsedEvents.has(event.id) && (
              <div className="mt-3 pt-3 border-t border-dark-800">
                {renderEventContent(event)}
              </div>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {streaming && (
          <div className="card border-corp-green-500/30">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-corp-green-400" />
              <div>
                <p className="font-medium text-corp-green-400">Agent is working...</p>
                <p className="text-dark-500 text-sm mt-0.5">Discovering and analyzing partners</p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card border-red-500/30">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-red-400">Error</p>
                <p className="text-dark-400 text-sm mt-1">{error}</p>
              </div>
              <button onClick={() => startAgent('continue')} className="btn-secondary text-sm py-1.5 px-4">
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Approval Gate */}
        {awaitingApproval && (
          <div className="card border-amber-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Pause className="w-5 h-5 text-amber-400" />
              <div>
                <p className="font-medium text-amber-400">Approval Required</p>
                <p className="text-dark-400 text-sm mt-0.5">{approvalMessage}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={approveAndContinue} className="btn-primary">
                Approve & Continue
              </button>
              <Link href="/sessions" className="btn-secondary">
                Pause Session
              </Link>
            </div>
          </div>
        )}

        {/* Resume button */}
        {canResume && (
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Session paused</p>
                <p className="text-dark-500 text-sm">Resume the agent to continue discovery</p>
              </div>
              <button onClick={() => startAgent('continue')} className="btn-primary">
                Resume Agent
              </button>
            </div>
          </div>
        )}

        {/* Agent summary message */}
        {agentMessage && (
          <div className="card border-corp-green-500/30">
            <p className="text-dark-300 text-sm whitespace-pre-wrap">{agentMessage}</p>
          </div>
        )}

        {/* Completed */}
        {isCompleted && (
          <div className="card border-corp-green-500/30">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-corp-green-400" />
              <div>
                <p className="font-medium text-corp-green-400">Discovery Complete</p>
                <p className="text-dark-400 text-sm mt-0.5">
                  {session.partners_added} partners discovered, {session.contacts_found} contacts found, {session.drafts_filed} drafts created.
                </p>
              </div>
              <Link href="/partners" className="btn-secondary ml-auto">
                View Partners
              </Link>
            </div>
          </div>
        )}

        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
