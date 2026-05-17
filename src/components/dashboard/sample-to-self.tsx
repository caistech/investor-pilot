'use client';

import { useState } from 'react';
import { Sparkles, Send, X, Loader2, AlertCircle, CheckCircle2, Mail, Link2 } from 'lucide-react';

interface SampleToSelfProps {
  hasSenderLinkedinUrl: boolean;
  operatorEmail: string;
}

interface SampleResponse {
  ok: boolean;
  error?: string;
  code?: 'needs_linkedin' | 'needs_sender_identity';
  blocker?: string;
  hint?: string;
  enrichment?: {
    source_used: 'linkedin' | 'brave' | 'both' | 'none';
    linkedin?: { status: string; message?: string; posts_fetched_count: number; profile_fetched: boolean };
    brave?: { status: string; message?: string };
  };
  rendered?: {
    subject: string | null;
    body: string;
    personalization_score: number;
    evidence_refs: Record<string, unknown>;
  };
  sent?: { id?: string; error?: string; to: string };
}

/**
 * One-click self-diagnostic. Runs the FULL outbound pipeline against the
 * operator themselves: Brave + LinkedIn enrichment → render → send → preview.
 *
 * If the org's sender LinkedIn URL isn't set, opens an inline modal first
 * to capture it (writes via PATCH /api/settings/sender). The whole flow is
 * one button, two-clicks-max from cold dashboard to inbox preview — designed
 * as the first thing a new operator does so they see the system working
 * before any project / product / sequence setup.
 */
export function SampleToSelf({ hasSenderLinkedinUrl, operatorEmail }: SampleToSelfProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SampleResponse | null>(null);
  const [showLinkedinModal, setShowLinkedinModal] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [savingLinkedin, setSavingLinkedin] = useState(false);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const [hasLinkedin, setHasLinkedin] = useState(hasSenderLinkedinUrl);

  async function runSample() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/dashboard/sample-to-self', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      // Defensive non-JSON parse — Vercel can return HTML error pages on
      // timeout, and surfacing those as "Unexpected token 'A'" is the bug
      // we've been chasing across the platform.
      const text = await res.text();
      let json: SampleResponse;
      try {
        json = JSON.parse(text) as SampleResponse;
      } catch {
        setResult({
          ok: false,
          error: `HTTP ${res.status}: ${text.slice(0, 200) || '(empty body)'}`,
        });
        return;
      }
      if (!res.ok) {
        if (json.code === 'needs_linkedin') {
          // Caller pre-validates hasSenderLinkedinUrl, but if it's stale
          // (operator cleared the URL in another tab) open the modal again
          // rather than show a confusing error.
          setShowLinkedinModal(true);
          setHasLinkedin(false);
          return;
        }
        setResult(json);
        return;
      }
      setResult(json);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }

  async function saveLinkedinAndRun() {
    setSavingLinkedin(true);
    setLinkedinError(null);
    const trimmed = linkedinUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setLinkedinError('URL must start with http:// or https://');
      setSavingLinkedin(false);
      return;
    }
    try {
      const res = await fetch('/api/settings/sender', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_linkedin_url: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLinkedinError(json.error || 'Save failed');
        return;
      }
      setHasLinkedin(true);
      setShowLinkedinModal(false);
      await runSample();
    } catch (err) {
      setLinkedinError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingLinkedin(false);
    }
  }

  function handleClick() {
    if (!hasLinkedin) {
      setShowLinkedinModal(true);
      return;
    }
    runSample();
  }

  return (
    <>
      <div className="card border-corp-green-500/30 bg-corp-green-500/5 mb-6">
        <div className="flex items-start gap-3">
          <Sparkles className="w-6 h-6 text-corp-green-400 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="text-corp-green-400">Send yourself a sample</h4>
            <p className="text-dark-300 mt-1 text-sm">
              One click runs the full outbound pipeline against you: Brave + LinkedIn enrichment on your own profile, fit-signal extraction, cold-email render, delivery to your inbox. The fastest way to see what the system would write to a real prospect — and to verify your own public footprint gives it enough to work with.
            </p>
            <button
              onClick={handleClick}
              disabled={running}
              className="btn-primary inline-flex items-center gap-2 mt-4 disabled:opacity-50"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {running ? 'Enriching + rendering…' : 'Send yourself a sample email'}
            </button>
            <p className="text-xs text-dark-500 mt-2">
              Goes to <span className="text-dark-300">{operatorEmail}</span>. Uses a built-in sample raise — no project/product setup required.
            </p>
          </div>
        </div>

        {/* Result panel — appears in place once the request settles */}
        {result && (
          <div className="mt-4 pt-4 border-t border-corp-green-500/20">
            {result.ok ? (
              <ResultSuccess result={result} />
            ) : (
              <ResultError result={result} />
            )}
          </div>
        )}
      </div>

      {/* LinkedIn capture modal */}
      {showLinkedinModal && (
        <LinkedinModal
          value={linkedinUrl}
          onChange={setLinkedinUrl}
          onSave={saveLinkedinAndRun}
          onClose={() => setShowLinkedinModal(false)}
          saving={savingLinkedin}
          error={linkedinError}
        />
      )}
    </>
  );
}

function ResultSuccess({ result }: { result: SampleResponse }) {
  const enrichment = result.enrichment!;
  const rendered = result.rendered!;
  const sent = result.sent!;
  const sentOk = !!sent.id;

  return (
    <div className="space-y-4">
      {/* Send status banner */}
      <div className={`flex items-start gap-2 text-sm ${sentOk ? 'text-corp-green-400' : 'text-amber-400'}`}>
        {sentOk ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
        <div>
          <p className="font-medium">{sentOk ? 'Sent.' : 'Render OK — email send failed.'}</p>
          {result.hint && <p className="text-dark-400 text-xs mt-1">{result.hint}</p>}
        </div>
      </div>

      {/* Enrichment summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <EnrichmentBadge
          icon={Link2}
          label="LinkedIn"
          status={enrichment.linkedin?.status || 'skipped'}
          detail={
            enrichment.linkedin?.posts_fetched_count
              ? `${enrichment.linkedin.posts_fetched_count} recent posts`
              : enrichment.linkedin?.message || 'Skipped — no active channel'
          }
        />
        <EnrichmentBadge
          icon={Sparkles}
          label="Brave firm-news"
          status={enrichment.brave?.status || 'skipped'}
          detail={enrichment.brave?.message || (enrichment.brave?.status === 'success' ? 'News + deal signals found' : 'Run skipped')}
        />
      </div>

      {/* Rendered draft preview */}
      <div>
        <p className="text-dark-400 text-xs mb-2 flex items-center gap-2">
          <Mail className="w-3 h-3" />
          Rendered draft (personalisation score {rendered.personalization_score}/10)
        </p>
        <div className="bg-dark-900 border border-dark-700 rounded-lg p-4">
          {rendered.subject && (
            <p className="text-sm font-medium text-dark-200 mb-3 pb-3 border-b border-dark-800">
              Subject: {rendered.subject}
            </p>
          )}
          <pre className="text-xs text-dark-300 whitespace-pre-wrap font-sans leading-relaxed">
            {rendered.body}
          </pre>
        </div>
      </div>
    </div>
  );
}

function ResultError({ result }: { result: SampleResponse }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-400">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-medium">Sample run failed</p>
        <p className="text-dark-300 text-xs mt-1">{result.error || 'Unknown error'}</p>
        {result.hint && <p className="text-dark-400 text-xs mt-2">{result.hint}</p>}
      </div>
    </div>
  );
}

function EnrichmentBadge({
  icon: Icon,
  label,
  status,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: string;
  detail: string;
}) {
  const ok = status === 'success' || status === 'partial';
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3 h-3 ${ok ? 'text-corp-green-400' : 'text-dark-500'}`} />
        <span className="text-dark-300 font-medium">{label}</span>
        <span className={`text-[10px] uppercase tracking-wide ${ok ? 'text-corp-green-400' : 'text-dark-500'}`}>
          {status}
        </span>
      </div>
      <p className="text-dark-500 text-xs">{detail}</p>
    </div>
  );
}

function LinkedinModal({
  value,
  onChange,
  onSave,
  onClose,
  saving,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-950 border border-dark-700 rounded-xl max-w-md w-full p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h4 className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-400" />
              Your LinkedIn URL
            </h4>
            <p className="text-dark-400 text-sm mt-1">
              The sample test enriches YOU as if you were a prospect — same Brave + LinkedIn pass the system runs on every real investor. We need your LinkedIn URL to do the lookup.
            </p>
          </div>
          <button onClick={onClose} className="text-dark-500 hover:text-white" disabled={saving}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-dark-400 text-sm mb-1">LinkedIn URL</label>
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://www.linkedin.com/in/your-handle"
          className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          autoFocus
        />
        <p className="text-xs text-dark-500 mt-1">
          Saved to your organisation settings — used in every cold message you send (recipients always look you up before responding).
        </p>

        {error && (
          <p className="text-red-400 text-sm mt-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onSave}
            disabled={saving || !value.trim()}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {saving ? 'Saving + running…' : 'Save and run sample'}
          </button>
          <button onClick={onClose} disabled={saving} className="btn-secondary text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
