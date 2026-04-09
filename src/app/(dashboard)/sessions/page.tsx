'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Play, Pause, CheckCircle, Clock, ChevronRight, Loader2 } from 'lucide-react';
import type { SessionMode, AgentSession } from '@/lib/types';

export default function SessionsPage() {
  const [showNew, setShowNew] = useState(false);
  const [mode, setMode] = useState<SessionMode>('guided');
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  async function getOrgId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('organisation_id')
      .eq('id', user.id)
      .single();
    return profile?.organisation_id || null;
  }

  useEffect(() => {
    async function loadSessions() {
      const orgId = await getOrgId();
      if (!orgId) {
        setLoadingSessions(false);
        return;
      }

      const { data } = await supabase
        .from('agent_sessions')
        .select('*')
        .eq('organisation_id', orgId)
        .order('started_at', { ascending: false });

      if (data) setSessions(data as AgentSession[]);
      setLoadingSessions(false);
    }
    loadSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSession() {
    setLoading(true);
    const orgId = await getOrgId();
    if (!orgId) return;

    // Get first active product
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .limit(1)
      .single();

    const { data: session } = await supabase
      .from('agent_sessions')
      .insert({
        organisation_id: orgId,
        product_id: product?.id || null,
        mode,
        status: 'active',
        current_stage: 'initialise',
      })
      .select()
      .single();

    if (session) {
      router.push(`/sessions/${session.id}`);
    }
    setLoading(false);
  }

  function formatStage(stage: string): string {
    return stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Agent Sessions</h1>
          <p className="text-dark-400 mt-1">AI-powered partnership discovery pipeline</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      {showNew && (
        <div className="card mb-8">
          <h3 className="mb-4">Start New Session</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => setMode('guided')}
              className={`p-4 rounded-lg border text-left ${
                mode === 'guided'
                  ? 'border-corp-green-500 bg-corp-green-500/10'
                  : 'border-dark-600 bg-dark-800'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Pause className="w-5 h-5" />
                <span className="font-semibold">Guided Mode</span>
              </div>
              <p className="text-dark-400 text-sm">
                Pause for your approval after each stage. Review categories, candidates, contacts, and drafts before proceeding.
              </p>
            </button>
            <button
              onClick={() => setMode('batch')}
              className={`p-4 rounded-lg border text-left ${
                mode === 'batch'
                  ? 'border-corp-green-500 bg-corp-green-500/10'
                  : 'border-dark-600 bg-dark-800'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Play className="w-5 h-5" />
                <span className="font-semibold">Batch Mode</span>
              </div>
              <p className="text-dark-400 text-sm">
                Run discovery, scoring, and contact finding in one pass. Stop only before drafting each email.
              </p>
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={startSession} disabled={loading} className="btn-primary disabled:opacity-50">
              {loading ? 'Starting...' : 'Start Session'}
            </button>
            <button onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Session History */}
      {loadingSessions ? (
        <div className="card text-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-dark-600 mx-auto" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="card text-center py-16">
          <CheckCircle className="w-12 h-12 text-dark-600 mx-auto mb-4" />
          <p className="text-dark-400">No sessions yet. Start your first pipeline run above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((sess) => (
            <Link
              key={sess.id}
              href={`/sessions/${sess.id}`}
              className="card-hover flex items-center gap-4 group"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                sess.status === 'active' ? 'bg-corp-green-500/10' :
                sess.status === 'completed' ? 'bg-dark-700' : 'bg-amber-500/10'
              }`}>
                {sess.status === 'active' ? (
                  <Play className="w-5 h-5 text-corp-green-400" />
                ) : sess.status === 'completed' ? (
                  <CheckCircle className="w-5 h-5 text-dark-400" />
                ) : (
                  <Pause className="w-5 h-5 text-amber-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {sess.mode === 'guided' ? 'Guided' : 'Batch'} Session
                  </span>
                  <span className={
                    sess.status === 'active' ? 'badge-green' :
                    sess.status === 'completed' ? 'badge-grey' : 'badge-amber'
                  }>
                    {sess.status}
                  </span>
                  {sess.current_stage && sess.current_stage !== 'initialise' && (
                    <span className="badge-blue">{formatStage(sess.current_stage)}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-dark-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {formatTime(sess.started_at)}
                  </span>
                  <span>{sess.partners_added} partners</span>
                  <span>{sess.contacts_found} contacts</span>
                  <span>{sess.drafts_filed} drafts</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-600 group-hover:text-white transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
