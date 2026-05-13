'use client';

import { useEffect, useState } from 'react';
import { Search, Upload, Loader2, CheckCircle, XCircle, ArrowRight, Send, Globe2, Briefcase, Package } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type DiscoverSource = 'linkedin' | 'sales_nav' | 'brave';

interface DiscoverResult {
  company_name: string;
  domain: string;
  status: string;
  weighted_score?: number;
  source?: DiscoverSource;
  error?: string;
}

interface ProductOption {
  id: string;
  name: string;
}

const SOURCE_LABELS: Record<DiscoverSource, { label: string; description: string; icon: typeof Search }> = {
  linkedin: {
    label: 'LinkedIn',
    description: 'People search via your connected LinkedIn account. Primary engine — returns prospects with profile URLs attached.',
    icon: Send,
  },
  sales_nav: {
    label: 'Sales Navigator',
    description: 'Richer filters (seniority, function, years in role). Requires your account to have an active Sales Navigator subscription.',
    icon: Briefcase,
  },
  brave: {
    label: 'Web (Brave)',
    description: 'Supplementary web search. Useful for company-level signals (news, press, deal participation) not visible on LinkedIn.',
    icon: Globe2,
  },
};

export default function DiscoverPage() {
  const [mode, setMode] = useState<'search' | 'seed'>('search');
  const [query, setQuery] = useState('');
  const [domains, setDomains] = useState('');
  const [sources, setSources] = useState<DiscoverSource[]>(['linkedin']);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DiscoverResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const supabase = createClient();

  // Load active products so the operator can pick which one drives discovery
  // scoring context. Without this, the route silently uses the first product
  // and you get nonsense for multi-product orgs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('organisation_id')
        .eq('id', user.id)
        .single();
      if (!profile?.organisation_id) return;
      const { data } = await supabase
        .from('products')
        .select('id, name')
        .eq('organisation_id', profile.organisation_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (cancelled || !data) return;
      setProducts(data as ProductOption[]);
      if (data.length > 0) setSelectedProductId(data[0].id);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSource(s: DiscoverSource) {
    setSources(prev => {
      if (prev.includes(s)) {
        const next = prev.filter(p => p !== s);
        return next.length === 0 ? prev : next; // never empty
      }
      return [...prev, s];
    });
  }

  async function handleDiscover() {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const settingsRes = await fetch('/api/pipeline/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProductId || 'auto',
          organisation_id: 'auto',
          sources,
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

  const sourceUsesQuery = sources.some(s => s === 'linkedin' || s === 'sales_nav' || s === 'brave');

  return (
    <div>
      <div className="mb-6">
        <h1>Discover Prospects</h1>
        <p className="text-dark-400 mt-1">Find and score new investor prospects</p>
      </div>

      {/* Product picker — drives scoring context. Without an active product
          discovery doesn't know what facility it's evaluating lenders for. */}
      <div className="card mb-6">
        <div className="flex items-start gap-3">
          <Package className="w-5 h-5 text-corp-green-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="text-sm">Product / project</h4>
            <p className="text-dark-500 text-xs mt-0.5 mb-2">
              The product context (name, ICP fields, Knowledge Base) drives the scoring prompt — every candidate is evaluated against THIS product&apos;s ICP.
            </p>
            {products.length === 0 ? (
              <p className="text-amber-400 text-xs">
                No active products. <Link href="/products" className="underline">Create or activate one</Link> first.
              </p>
            ) : (
              <select
                value={selectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none"
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
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

      {/* Source picker — only when searching by query */}
      {mode === 'search' && (
        <div className="card mb-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="text-sm">Search sources</h4>
              <p className="text-dark-500 text-xs mt-1">
                Pick one or more. LinkedIn returns people with profile URLs attached;
                Brave returns company-level web hits.
              </p>
            </div>
            <span className="text-dark-600 text-xs whitespace-nowrap">
              {sources.length} selected
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(Object.keys(SOURCE_LABELS) as DiscoverSource[]).map(s => {
              const { label, description, icon: Icon } = SOURCE_LABELS[s];
              const selected = sources.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSource(s)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    selected
                      ? 'bg-corp-green-500/10 border-corp-green-500/40'
                      : 'bg-dark-800 border-dark-700 hover:border-dark-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${selected ? 'text-corp-green-400' : 'text-dark-500'}`} />
                    <span className="text-sm font-medium">{label}</span>
                    {s === 'linkedin' && <span className="badge-green text-[10px]">Primary</span>}
                    {s === 'brave' && <span className="text-dark-600 text-[10px] uppercase tracking-wide">Supplement</span>}
                  </div>
                  <p className="text-dark-500 text-xs">{description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="card mb-6">
        {mode === 'search' ? (
          <div>
            <label className="text-dark-400 text-sm block mb-2">Search Query</label>
            <p className="text-dark-500 text-xs mb-3">
              Lender-channel examples: &quot;family office private debt Sydney&quot;, &quot;Australian property development senior debt fund&quot;, &quot;HNW direct lender residential construction&quot;
            </p>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. family office private debt Australia"
              className="w-full bg-dark-800 border border-dark-700 rounded px-4 py-3 text-sm focus:border-corp-green-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleDiscover()}
            />
          </div>
        ) : (
          <div>
            <label className="text-dark-400 text-sm block mb-2">Domain List</label>
            <p className="text-dark-500 text-xs mb-3">
              Paste one domain per line. These companies will be researched and scored against the lender ICP.
            </p>
            <textarea
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder={"familyoffice.example.com.au\nprivatecreditfund.example.com\n..."}
              rows={6}
              className="w-full bg-dark-800 border border-dark-700 rounded px-4 py-3 text-sm focus:border-corp-green-500 focus:outline-none resize-y font-mono"
            />
          </div>
        )}

        <button
          onClick={handleDiscover}
          disabled={loading || !selectedProductId || (mode === 'search' ? !query.trim() || !sourceUsesQuery : !domains.trim())}
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
                  <div className="text-dark-500 text-xs flex items-center gap-2">
                    <span className="truncate">{r.domain}</span>
                    {r.source && (
                      <span className="text-dark-600 text-[10px] uppercase tracking-wide px-1.5 py-0.5 bg-dark-900 rounded">
                        {r.source === 'sales_nav' ? 'Sales Nav' : r.source}
                      </span>
                    )}
                  </div>
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
                  r.status === 'created' || r.status === 'contact_found' ? 'bg-corp-green-500/10 text-corp-green-400' :
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
          <p className="text-xs mt-2">Each candidate scored on capital, asset-class focus, track record, decision authority, and reachability per the v3 lender ICP.</p>
        </div>
      )}
    </div>
  );
}
