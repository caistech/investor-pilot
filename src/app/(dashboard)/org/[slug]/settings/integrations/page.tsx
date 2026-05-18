'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plug, KeyRound, CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react';

interface UnipileStatus {
  has_key: boolean;
  masked_key: string | null;
  tenant_id: string | null;
  platform_fallback_available: boolean;
}

export default function IntegrationsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const settingsHref = slug ? `/org/${slug}/settings` : '/settings';

  const [status, setStatus] = useState<UnipileStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/org/unipile');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      const json = (await res.json()) as UnipileStatus;
      setStatus(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/org/unipile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim(), base_url: baseUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setMessage('Unipile key validated and saved. Future LinkedIn / email connects in this org will route through your tenant.');
      setApiKey('');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm('Clear this org\'s Unipile key? Future connects will use the InvestorPilot shared tenant. Existing connected accounts continue working under the credentials they were created with.')) return;
    setError(null);
    try {
      const res = await fetch('/api/org/unipile', { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Clear failed');
      setMessage('Org Unipile key cleared. Future connects use the InvestorPilot shared tenant.');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="max-w-2xl">
      <Link href={settingsHref} className="flex items-center gap-2 text-dark-400 hover:text-white mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to settings
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <Plug className="w-6 h-6 text-corp-green-400" />
        <h1>Integrations</h1>
      </div>
      <p className="text-dark-400 mb-8">
        Bring your own integration credentials so outreach runs from your tenant — useful if you operate InvestorPilot across multiple client orgs and want each to be billed and risk-isolated on its own LinkedIn / email infrastructure.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span className="text-sm">{error}</span>
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 rounded-lg bg-corp-green-500/10 border border-corp-green-500/30 text-corp-green-300 text-sm">
          {message}
        </div>
      )}

      <div className="card">
        <h3 className="flex items-center gap-2 mb-3">
          <KeyRound className="w-5 h-5 text-corp-green-400" /> Unipile (LinkedIn + Gmail / Outlook)
        </h3>

        {loading ? (
          <div className="text-center py-8 text-dark-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <>
            {status?.has_key ? (
              <div className="mb-4 p-3 bg-corp-green-500/10 border border-corp-green-500/30 rounded">
                <div className="flex items-center gap-2 text-corp-green-300 text-sm font-medium mb-1">
                  <CheckCircle2 className="w-4 h-4" /> BYOK active for this org
                </div>
                <div className="text-dark-400 text-xs">
                  Using key <code className="text-dark-300">{status.masked_key}</code>. Every new LinkedIn / email connect in this org routes through your Unipile tenant.
                </div>
                <button
                  onClick={handleClear}
                  className="mt-3 text-xs inline-flex items-center gap-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" /> Clear key (fall back to shared tenant)
                </button>
              </div>
            ) : (
              <div className="mb-4 p-3 bg-dark-800 border border-dark-700 rounded text-sm text-dark-400">
                {status?.platform_fallback_available
                  ? 'Currently using the InvestorPilot shared Unipile tenant. Set your own key below to route through your tenant instead.'
                  : 'No Unipile credentials configured at the platform level either — you must set a key here to enable LinkedIn and Unipile-routed email channels.'}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Unipile API key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your Unipile API key"
                  className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none font-mono"
                />
                <p className="text-dark-500 text-xs mt-1">
                  From your Unipile dashboard → Settings → API. We validate the key against Unipile before saving.
                </p>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Unipile base URL (DSN)</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://apiX.unipile.com:13XXX"
                  className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none font-mono"
                />
                <p className="text-dark-500 text-xs mt-1">
                  Each Unipile tenant has its own URL. Copy from the Unipile dashboard — typically <code className="text-dark-300">https://apiX.unipile.com:13XXX</code>.
                </p>
              </div>
              <button
                type="submit"
                disabled={saving || !apiKey.trim() || !baseUrl.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Validating…</> : 'Validate and save'}
              </button>
            </form>
          </>
        )}
      </div>

      <div className="mt-8 text-xs text-dark-500 max-w-2xl">
        <p className="mb-2"><strong className="text-dark-300">Why BYOK?</strong></p>
        <ul className="space-y-1 list-disc list-outside ml-5">
          <li>Your LinkedIn / email outreach risk stays scoped to your tenant — if one client's activity gets flagged, it doesn't affect other clients on the platform.</li>
          <li>Direct Unipile billing — you control the cost, you choose the plan tier.</li>
          <li>Independent webhook + rate limits — no contention with other tenants on the shared infrastructure.</li>
        </ul>
        <p className="mt-3"><strong className="text-dark-300">What happens after I save?</strong></p>
        <ul className="space-y-1 list-disc list-outside ml-5">
          <li>Future hosted-auth connects in this org route through your tenant — existing connected accounts stay on whichever credentials they were created with until you re-connect them.</li>
          <li>Sends initiated from this org use your tenant's quotas + rate-limit budget.</li>
        </ul>
      </div>
    </div>
  );
}
