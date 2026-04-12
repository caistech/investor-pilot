'use client';

import { useState } from 'react';
import { Search, Upload, Loader2, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface DiscoverResult {
  company_name: string;
  domain: string;
  status: string;
  weighted_score?: number;
  error?: string;
}

export default function DiscoverPage() {
  const [mode, setMode] = useState<'search' | 'seed'>('search');
  const [query, setQuery] = useState('');
  const [domains, setDomains] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DiscoverResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);

  // Load org and product on first render
  useState(() => {
    fetch('/api/partners')
      .then(() => {
        // Get profile info from a lightweight endpoint
        fetch('/api/sessions')
          .then(r => r.json())
          .catch(() => null);
      })
      .catch(() => null);
  });

  async function handleDiscover() {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // First get org and product IDs
      const profileRes = await fetch('/api/export?' + new URLSearchParams({ format: 'json' }));
      // Fallback: use a dedicated lightweight endpoint
      const settingsRes = await fetch('/api/pipeline/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId || 'auto',
          organisation_id: orgId || 'auto',
          ...(mode === 'search' ? { query } : {}),
          ...(mode === 'seed' ? { domains: domains.split('\n').map(d => d.trim()).filter(Boolean) } : {}),
        }),
      });

      const data = await settingsRes.json();

      if (!settingsRes.ok) {
        setError(data.error || 'Discovery failed');
      } else {
        setResults(data.results || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1>Discover Prospects</h1>
        <p className="text-dark-400 mt-1">Find and score new investor prospects</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMode('search')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
            mode === 'search' ? 'bg-corp-green-500/20 text-corp-green-400 border border-corp-green-500/30' : 'bg-dark-800 text-dark-400 border border-dark-700 hover:text-white'
          }`}
        >
          <Search className="w-4 h-4" /> Search by Query
        </button>
        <button
          onClick={() => setMode('seed')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
            mode === 'seed' ? 'bg-corp-green-500/20 text-corp-green-400 border border-corp-green-500/30' : 'bg-dark-800 text-dark-400 border border-dark-700 hover:text-white'
          }`}
        >
          <Upload className="w-4 h-4" /> Seed List
        </button>
      </div>

      {/* Input */}
      <div className="card mb-6">
        {mode === 'search' ? (
          <div>
            <label className="text-dark-400 text-sm block mb-2">Search Query</label>
            <p className="text-dark-500 text-xs mb-3">
              Try queries like &quot;R&amp;D tax consultants Australia&quot; or &quot;startup accelerators Melbourne&quot;
            </p>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. R&D tax advisory firms Australia"
              className="w-full bg-dark-800 border border-dark-700 rounded px-4 py-3 text-sm focus:border-corp-green-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleDiscover()}
            />
          </div>
        ) : (
          <div>
            <label className="text-dark-400 text-sm block mb-2">Domain List</label>
            <p className="text-dark-500 text-xs mb-3">
              Paste one domain per line. These companies will be researched and scored.
            </p>
            <textarea
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder={"swansonreed.com.au\npitcher.com.au\nazuregroup.com.au"}
              rows={6}
              className="w-full bg-dark-800 border border-dark-700 rounded px-4 py-3 text-sm focus:border-corp-green-500 focus:outline-none resize-y font-mono"
            />
          </div>
        )}

        <button
          onClick={handleDiscover}
          disabled={loading || (mode === 'search' ? !query.trim() : !domains.trim())}
          className="btn-primary mt-4 flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Discovering & scoring...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Discover Prospects
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-red-500/30 mb-6">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h4>Discovery Results</h4>
            <span className="text-dark-400 text-sm">
              {results.filter(r => r.status !== 'error').length} scored,{' '}
              {results.filter(r => r.status === 'error').length} errors
            </span>
          </div>

          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg">
                {r.status === 'error' ? (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-corp-green-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{r.company_name}</div>
                  <div className="text-dark-500 text-xs">{r.domain}</div>
                </div>
                {r.weighted_score && (
                  <span className="font-mono text-corp-green-400 font-bold">
                    {r.weighted_score.toFixed(1)}
                  </span>
                )}
                {r.error && (
                  <span className="text-red-400 text-xs truncate max-w-48">{r.error}</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded ${
                  r.status === 'error' ? 'bg-red-500/10 text-red-400' :
                  r.status === 'created' ? 'bg-corp-green-500/10 text-corp-green-400' :
                  'bg-blue-500/10 text-blue-400'
                }`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>

          {results.some(r => r.status !== 'error') && (
            <Link
              href="/partners"
              className="btn-primary mt-6 inline-flex items-center gap-2"
            >
              View in Prospects <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      )}

      {/* Empty state */}
      {!results && !loading && (
        <div className="card text-center py-12 text-dark-500">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Search for investor prospects or paste a list of domains to get started.</p>
          <p className="text-xs mt-2">Each company will be scored on audience overlap, complementarity, readiness, reachability, and leverage.</p>
        </div>
      )}
    </div>
  );
}
