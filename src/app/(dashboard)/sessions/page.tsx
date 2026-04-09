'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Plus, Play, Pause, CheckCircle } from 'lucide-react';
import type { SessionMode } from '@/lib/types';

export default function SessionsPage() {
  const [showNew, setShowNew] = useState(false);
  const [mode, setMode] = useState<SessionMode>('guided');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  async function startSession() {
    setLoading(true);
    const { data: profile } = await supabase.from('profiles').select('organisation_id').single();
    if (!profile?.organisation_id) return;

    // Get first active product
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('organisation_id', profile.organisation_id)
      .eq('is_active', true)
      .limit(1)
      .single();

    const { data: session, error } = await supabase
      .from('agent_sessions')
      .insert({
        organisation_id: profile.organisation_id,
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

      <div className="card text-center py-16">
        <CheckCircle className="w-12 h-12 text-dark-600 mx-auto mb-4" />
        <p className="text-dark-400">Session history will appear here after your first run.</p>
      </div>
    </div>
  );
}
