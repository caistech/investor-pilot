'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Play, Pause, CheckCircle, Clock, ChevronRight, Loader2, Package, Trash2 } from 'lucide-react';
import type { SessionMode, AgentSession, Product } from '@/lib/types';
import { SetupGate } from '@/components/layout/setup-gate';

export default function SessionsPage() {
  const [showNew, setShowNew] = useState(false);
  const [mode, setMode] = useState<SessionMode>('guided');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
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
    async function loadData() {
      const orgId = await getOrgId();
      if (!orgId) {
        setLoadingSessions(false);
        return;
      }

      const [sessResult, prodResult] = await Promise.all([
        supabase
          .from('agent_sessions')
          .select('*, products(name)')
          .eq('organisation_id', orgId)
          .order('started_at', { ascending: false }),
        supabase
          .from('products')
          .select('*')
          .eq('organisation_id', orgId)
          .eq('is_active', true)
          .order('name'),
      ]);

      if (sessResult.data) setSessions(sessResult.data as AgentSession[]);
      if (prodResult.data) {
        setProducts(prodResult.data as Product[]);
        if (prodResult.data.length > 0) setSelectedProductId(prodResult.data[0].id);
      }
      setLoadingSessions(false);
    }
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSession() {
    if (!selectedProductId) return;
    setLoading(true);
    const orgId = await getOrgId();
    if (!orgId) return;

    const { data: session } = await supabase
      .from('agent_sessions')
      .insert({
        organisation_id: orgId,
        product_id: selectedProductId,
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

  async function deleteSession(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((s) => s.id !== id));
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
          <p className="text-dark-400 mt-1">AI-powered investor discovery pipeline</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      <SetupGate
        required={['hasActiveProduct', 'productPitchConfigured']}
        pageName="Sessions"
        pageVerb="start an AI research session"
      >

      {showNew && (
        <div className="card mb-8">
          <h3 className="mb-4">Start New Session</h3>

          {/* Product selection */}
          {products.length === 0 ? (
            <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-dark-500" />
                <div>
                  <p className="text-dark-300 font-medium">No products yet</p>
                  <p className="text-dark-500 text-sm">Add a product first so the pipeline knows what to search for.</p>
                </div>
                <Link href="/products" className="btn-primary text-sm py-1.5 px-4 ml-auto">Add Product</Link>
              </div>
            </div>
          ) : products.length === 1 ? (
            <div className="flex items-center gap-3 bg-dark-800 border border-dark-600 rounded-lg px-4 py-3 mb-6">
              <Package className="w-4 h-4 text-corp-green-400" />
              <span className="font-medium">{products[0].name}</span>
              <span className="text-dark-500 text-sm truncate">{products[0].one_sentence_description}</span>
            </div>
          ) : (
            <div className="mb-6">
              <label className="block text-sm text-dark-300 mb-2">Select Product</label>
              <div className="space-y-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProductId(p.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                      selectedProductId === p.id
                        ? 'border-corp-green-500 bg-corp-green-500/10'
                        : 'border-dark-600 bg-dark-800 hover:border-dark-500'
                    }`}
                  >
                    <Package className={`w-4 h-4 shrink-0 ${selectedProductId === p.id ? 'text-corp-green-400' : 'text-dark-500'}`} />
                    <div className="min-w-0">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-dark-500 text-sm truncate">{p.one_sentence_description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mode selection */}
          <label className="block text-sm text-dark-300 mb-2">Pipeline Mode</label>
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
            <button onClick={startSession} disabled={loading || !selectedProductId} className="btn-primary disabled:opacity-50">
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
            <div key={sess.id} className="card-hover flex items-center gap-4 group">
              <Link href={`/sessions/${sess.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
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
                      {(sess as unknown as { products?: { name: string } }).products?.name || 'Unknown Product'}
                    </span>
                    <span className="text-dark-500 text-xs">
                      {sess.mode === 'guided' ? 'Guided' : 'Batch'}
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
                <ChevronRight className="w-5 h-5 text-dark-600 group-hover:text-white transition-colors shrink-0" />
              </Link>
              <button
                onClick={(e) => deleteSession(e, sess.id)}
                className="p-2 text-dark-600 hover:text-red-400 transition-colors shrink-0"
                title="Delete session"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      </SetupGate>
    </div>
  );
}
