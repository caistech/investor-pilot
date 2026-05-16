import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { MonthlyUsage } from '@/lib/usage/events';

/**
 * Dashboard usage banner. Only renders when at least one usage line is at
 * or above 80% of its monthly cap. Stays hidden otherwise so the dashboard
 * doesn't get cluttered for healthy orgs.
 */
export function UsageBanner({ usage }: { usage: MonthlyUsage }) {
  const lines = [
    { key: 'brave_queries', label: 'discovery queries', used: usage.brave_queries.used, limit: usage.brave_queries.limit },
    { key: 'hunter_lookups', label: 'email enrichments', used: usage.hunter_lookups.used, limit: usage.hunter_lookups.limit },
    { key: 'unipile_accounts', label: 'connected accounts', used: usage.unipile_accounts.used, limit: usage.unipile_accounts.limit },
    { key: 'llm_tokens', label: 'AI tokens', used: usage.llm_tokens.used, limit: usage.llm_tokens.limit },
  ];

  const warnings = lines
    .filter((l) => l.limit > 0 && l.used / l.limit >= 0.8)
    .map((l) => ({ ...l, pct: Math.round((l.used / l.limit) * 100) }));

  if (warnings.length === 0) return null;

  const anyExceeded = warnings.some((w) => w.used >= w.limit);
  const tone = anyExceeded ? 'red' : 'amber';

  return (
    <div
      className={`card mb-6 ${
        tone === 'red'
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-amber-500/40 bg-amber-500/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={`w-5 h-5 mt-0.5 ${tone === 'red' ? 'text-red-400' : 'text-amber-400'}`} />
        <div className="flex-1">
          <p className={`font-semibold ${tone === 'red' ? 'text-red-400' : 'text-amber-400'}`}>
            {anyExceeded ? 'Monthly cap reached' : 'Approaching monthly cap'}
          </p>
          <ul className="mt-1 text-sm text-dark-200 space-y-0.5">
            {warnings.map((w) => (
              <li key={w.key}>
                · <span className="font-medium">{w.label}</span>: {w.used.toLocaleString()} / {w.limit.toLocaleString()}{' '}
                ({w.pct}%)
              </li>
            ))}
          </ul>
          <Link href="/settings" className="inline-block mt-2 text-sm text-corp-green-400 hover:underline">
            See details in Settings →
          </Link>
        </div>
      </div>
    </div>
  );
}
