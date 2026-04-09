'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle, Circle, Loader2, AlertTriangle,
  Search, Filter, BarChart3, Globe, UserSearch, Mail,
  Target, FileText, Play, Pause, ChevronDown, ChevronRight,
  ExternalLink, XCircle, Trash2,
} from 'lucide-react';
import type { PipelineStage, SessionMode } from '@/lib/types';

const STAGE_CONFIG: Record<string, {
  label: string;
  icon: typeof Search;
  description: string;
  apiRoute: string;
}> = {
  initialise: { label: 'Initialise', icon: Play, description: 'Starting session', apiRoute: '' },
  categories: { label: 'Categories', icon: Search, description: 'Identifying partner categories', apiRoute: '/api/agent/categories' },
  search: { label: 'Search', icon: Globe, description: 'Discovering candidate companies', apiRoute: '/api/agent/search' },
  screen: { label: 'Screen', icon: Filter, description: 'Filtering out poor fits', apiRoute: '/api/agent/screen' },
  score: { label: 'Score', icon: BarChart3, description: 'Scoring on 5 dimensions', apiRoute: '/api/agent/score' },
  browse: { label: 'Browse', icon: Globe, description: 'Researching company websites', apiRoute: '/api/agent/browse' },
  find_contact: { label: 'Find Contact', icon: UserSearch, description: 'Finding the right person', apiRoute: '/api/agent/find-contact' },
  enrich_email: { label: 'Enrich', icon: Mail, description: 'Verifying email addresses', apiRoute: '/api/agent/enrich-email' },
  select_motion: { label: 'Motion', icon: Target, description: 'Selecting partnership approach', apiRoute: '/api/agent/select-motion' },
  draft: { label: 'Draft', icon: FileText, description: 'Drafting outreach emails', apiRoute: '/api/agent/draft' },
  file_gmail: { label: 'File', icon: Mail, description: 'Filing drafts to Gmail', apiRoute: '/api/agent/file-gmail' },
  hunter_push: { label: 'Push', icon: ExternalLink, description: 'Pushing to Hunter campaigns', apiRoute: '/api/agent/hunter-push' },
};

// Stages that require approval in guided mode
const GUIDED_GATES: PipelineStage[] = ['categories', 'search', 'score', 'find_contact', 'select_motion', 'draft'];

// The active pipeline stages (skip enrich_email, file_gmail, hunter_push for now)
const ACTIVE_STAGES: PipelineStage[] = [
  'initialise', 'categories', 'search', 'screen', 'score',
  'browse', 'find_contact', 'select_motion', 'draft',
];

interface SessionData {
  id: string;
  product_id: string;
  mode: SessionMode;
  status: string;
  current_stage: PipelineStage;
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [collapsedEvents, setCollapsedEvents] = useState<Set<string>>(new Set());
  // Store intermediate data between stages
  const stageData = useRef<Record<string, unknown>>({});
  const feedEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const scrollToBottom = useCallback(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load session and events
  useEffect(() => {
    async function load() {
      const { data: sess } = await supabase
        .from('agent_sessions')
        .select('*')
        .eq('id', params.id)
        .single();

      if (sess) {
        setSession(sess as SessionData);
      }

      const { data: evts } = await supabase
        .from('session_events')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });

      if (evts) {
        setEvents(evts as EventCard[]);
      }
    }
    load();
  }, [params.id, supabase]);

  useEffect(() => {
    scrollToBottom();
  }, [events, scrollToBottom]);

  function getNextStage(): PipelineStage | null {
    if (!session) return null;
    const idx = ACTIVE_STAGES.indexOf(session.current_stage);
    if (idx < 0 || idx >= ACTIVE_STAGES.length - 1) return null;
    return ACTIVE_STAGES[idx + 1];
  }

  function getStageStatus(stage: PipelineStage): 'completed' | 'current' | 'pending' | 'error' {
    if (!session) return 'pending';
    const currentIdx = ACTIVE_STAGES.indexOf(session.current_stage);
    const stageIdx = ACTIVE_STAGES.indexOf(stage);
    if (stageIdx < currentIdx) return 'completed';
    if (stageIdx === currentIdx) return running ? 'current' : 'completed';
    return 'pending';
  }

  async function runNextStage() {
    if (!session) return;
    const nextStage = getNextStage();
    if (!nextStage) return;

    setRunning(true);
    setError(null);
    setAwaitingApproval(false);

    try {
      const config = STAGE_CONFIG[nextStage];
      if (!config?.apiRoute) {
        setError(`No API route configured for stage: ${nextStage}`);
        setRunning(false);
        return;
      }

      // Build the request body based on the stage
      const body = buildStageRequest(nextStage);

      const res = await fetch(config.apiRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        setError(result.error || `Stage ${nextStage} failed`);
        setRunning(false);
        return;
      }

      // Store stage data for subsequent stages
      stageData.current[nextStage] = result.data;

      // Refresh session and events
      await refreshSession();

      // Check if we need approval (guided mode)
      if (session.mode === 'guided' && GUIDED_GATES.includes(nextStage)) {
        setAwaitingApproval(true);
        setRunning(false);
        return;
      }

      // In batch mode, auto-advance (except before draft)
      if (session.mode === 'batch' && nextStage !== 'draft') {
        setRunning(false);
        // Small delay then auto-advance
        setTimeout(() => runNextStage(), 500);
        return;
      }

      setRunning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setRunning(false);
    }
  }

  function buildStageRequest(stage: PipelineStage): Record<string, unknown> {
    const base = { session_id: session!.id, product_id: session!.product_id };

    switch (stage) {
      case 'categories':
        return base;

      case 'search': {
        const catData = stageData.current.categories as { categories?: Array<{ category: string; rationale: string }> } | undefined;
        return { ...base, categories: catData?.categories || [] };
      }

      case 'screen': {
        const searchData = stageData.current.search as { candidates?: unknown[] } | undefined;
        return { ...base, candidates: searchData?.candidates || [] };
      }

      case 'score': {
        const screenData = stageData.current.screen as { passed?: unknown[] } | undefined;
        const searchData = stageData.current.search as { candidates?: unknown[] } | undefined;
        return { ...base, candidates: screenData?.passed || searchData?.candidates || [] };
      }

      case 'browse': {
        const scoreData = stageData.current.score as { scored_partners?: unknown[] } | undefined;
        return { ...base, candidates: scoreData?.scored_partners || [] };
      }

      case 'find_contact': {
        const browseData = stageData.current.browse as { browsed_candidates?: unknown[] } | undefined;
        return { ...base, partners: browseData?.browsed_candidates || [] };
      }

      case 'select_motion': {
        const scoreData = stageData.current.score as { scored_partners?: Array<Record<string, unknown>> } | undefined;
        const contactData = stageData.current.find_contact as { contacts?: Array<Record<string, unknown>> } | undefined;
        // Merge scored data with contact data
        const partners = (scoreData?.scored_partners || []).map((p) => {
          const contact = (contactData?.contacts || []).find((c) => c.domain === p.domain);
          return {
            ...p,
            contact_name: contact?.contact_name || null,
            contact_title: contact?.contact_title || null,
          };
        });
        return { ...base, partners };
      }

      case 'draft':
        // Draft is per-partner, handled differently
        return base;

      default:
        return base;
    }
  }

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

  function approveAndContinue() {
    setAwaitingApproval(false);
    runNextStage();
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
    await supabase.from('session_events').delete().eq('session_id', session.id);
    await supabase.from('agent_sessions').delete().eq('id', session.id);
    window.location.href = '/sessions';
  }

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
    return <Circle className="w-4 h-4 text-dark-400" />;
  }

  function renderEventContent(event: EventCard) {
    const d = event.event_data;

    switch (event.event_type) {
      case 'categories_generated':
        return (
          <div>
            <p className="text-dark-300 mb-2">{d.count as number} categories identified</p>
            <div className="space-y-1">
              {(d.categories as Array<{ category: string; rationale: string }>)?.map((cat, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="text-dark-500 font-mono w-5">{i + 1}.</span>
                  <div>
                    <span className="text-white font-medium">{cat.category}</span>
                    <span className="text-dark-400 ml-2">{cat.rationale}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'candidates_discovered':
        return (
          <div>
            <p className="text-dark-300 mb-2">
              {d.count as number} candidates from {d.categories_searched as number} categories
            </p>
            <div className="space-y-1">
              {(d.candidates as Array<{ company_name: string; domain: string; category: string }>)?.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-dark-500 font-mono w-5">{i + 1}.</span>
                  <span className="text-white">{c.company_name}</span>
                  <span className="text-dark-500">({c.domain})</span>
                  <span className="badge-grey text-xs">{c.category}</span>
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
          <div className="text-sm">
            <span className="text-dark-300">Subject: </span>
            <span className="text-white">{d.subject as string}</span>
          </div>
        );

      case 'stage_error':
        return (
          <div className="text-sm text-red-400">
            Stage "{d.stage as string}" failed: {d.error as string}
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

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-dark-400" />
      </div>
    );
  }

  const nextStage = getNextStage();
  const isCompleted = !nextStage && session.current_stage !== 'initialise';

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
          {/* Stats */}
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
          {/* Delete */}
          <button
            onClick={deleteSession}
            className="p-2 text-dark-600 hover:text-red-400 transition-colors"
            title="Delete session"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Stage Progress - Sidebar */}
        <div className="lg:col-span-1">
          <div className="card sticky top-8">
            <h4 className="text-sm font-semibold text-dark-400 uppercase tracking-wider mb-4">Pipeline</h4>
            <div className="space-y-1">
              {ACTIVE_STAGES.map((stage) => {
                const config = STAGE_CONFIG[stage];
                const status = getStageStatus(stage);
                const Icon = config.icon;

                return (
                  <div
                    key={stage}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                      status === 'current' ? 'bg-corp-green-500/10 text-corp-green-400' :
                      status === 'completed' ? 'text-dark-300' :
                      'text-dark-600'
                    }`}
                  >
                    {status === 'completed' ? (
                      <CheckCircle className="w-4 h-4 text-corp-green-500 shrink-0" />
                    ) : status === 'current' ? (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 shrink-0" />
                    )}
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{config.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Event Feed - Main */}
        <div className="lg:col-span-3 space-y-4">
          {/* Event cards */}
          {events.length === 0 && !running && (
            <div className="card text-center py-12">
              <Play className="w-10 h-10 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400 mb-4">Ready to start the partnership discovery pipeline.</p>
              <button onClick={runNextStage} className="btn-primary">
                Start Pipeline
              </button>
            </div>
          )}

          {events.map((event) => (
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

          {/* Running indicator */}
          {running && (
            <div className="card border-corp-green-500/30">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-corp-green-400" />
                <div>
                  <p className="font-medium text-corp-green-400">
                    {nextStage ? STAGE_CONFIG[nextStage]?.description : 'Processing...'}
                  </p>
                  <p className="text-dark-500 text-sm mt-0.5">This may take a moment</p>
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
                  <p className="font-medium text-red-400">Stage Failed</p>
                  <p className="text-dark-400 text-sm mt-1">{error}</p>
                </div>
                <button onClick={runNextStage} className="btn-secondary text-sm py-1.5 px-4">
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
                  <p className="text-dark-400 text-sm mt-0.5">
                    Review the {session.current_stage} results above, then approve to continue.
                  </p>
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

          {/* Continue button (when not running, not awaiting approval, and more stages remain) */}
          {!running && !awaitingApproval && !error && nextStage && events.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Next: {STAGE_CONFIG[nextStage]?.label}</p>
                  <p className="text-dark-500 text-sm">{STAGE_CONFIG[nextStage]?.description}</p>
                </div>
                <button onClick={runNextStage} className="btn-primary">
                  {session.mode === 'batch' ? 'Continue Pipeline' : 'Run Next Stage'}
                </button>
              </div>
            </div>
          )}

          {/* Completed */}
          {isCompleted && (
            <div className="card border-corp-green-500/30">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-corp-green-400" />
                <div>
                  <p className="font-medium text-corp-green-400">Pipeline Complete</p>
                  <p className="text-dark-400 text-sm mt-0.5">
                    {session.partners_added} partners discovered, {session.contacts_found} contacts found, {session.drafts_filed} drafts filed.
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
    </div>
  );
}
