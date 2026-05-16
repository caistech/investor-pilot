import type { MonthlyUsage } from '@/lib/usage/events';

interface UsageCardProps {
  usage: MonthlyUsage;
}

/**
 * Monthly usage snapshot for the /settings page. Renders four bars (Brave,
 * Hunter, Unipile, LLM tokens) with thresholds at 80% (amber) and 100%
 * (red). Server-rendered — feed it the result of getMonthlyUsage(orgId).
 */
export function UsageCard({ usage }: UsageCardProps) {
  const rows = [
    {
      label: 'Discovery queries (Brave)',
      hint: 'One per search inside a discovery batch.',
      ...usage.brave_queries,
      format: (n: number) => n.toLocaleString(),
    },
    {
      label: 'Email enrichments (Hunter)',
      hint: 'One per partner domain looked up.',
      ...usage.hunter_lookups,
      format: (n: number) => n.toLocaleString(),
    },
    {
      label: 'Connected accounts (LinkedIn + email)',
      hint: 'Each Unipile-connected channel counts.',
      ...usage.unipile_accounts,
      format: (n: number) => n.toLocaleString(),
    },
    {
      label: 'AI calls (input + output tokens)',
      hint: 'Used by scoring, query generation and draft writing.',
      ...usage.llm_tokens,
      format: (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${Math.round(n / 1000)}k`,
    },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4>Usage this month</h4>
          <p className="text-dark-400 text-xs mt-1">
            Resets on the 1st of each month. Caps are enforced — calls return a 429 once you reach the limit.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-dark-500">Plan</p>
          <p className="text-sm font-semibold capitalize">{usage.plan_tier}</p>
        </div>
      </div>

      <div className="space-y-4">
        {rows.map((row) => {
          const pct = row.limit > 0 ? Math.min(100, (row.used / row.limit) * 100) : 0;
          const tone = pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'green';
          const fillClass =
            tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-corp-green-500';
          const textClass =
            tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-dark-200';

          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-sm text-dark-200">{row.label}</p>
                <p className={`text-xs font-mono ${textClass}`}>
                  {row.format(row.used)} / {row.format(row.limit)}
                </p>
              </div>
              <div className="h-2 rounded-full bg-dark-800 overflow-hidden">
                <div
                  className={`h-full ${fillClass} transition-all duration-300`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[11px] text-dark-500 mt-1">{row.hint}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-dark-500 mt-4 pt-3 border-t border-dark-800">
        Need a higher cap? Reply to your onboarding thread or email{' '}
        <a href="mailto:support@corporateaisolutions.com" className="text-corp-green-400 hover:underline">
          support@corporateaisolutions.com
        </a>{' '}
        with the plan tier you want.
      </p>
    </div>
  );
}
