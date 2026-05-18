'use client';

import Link from 'next/link';
import { Printer } from 'lucide-react';
import type { PoolSummary } from '@/lib/pool/summary';
import type { LucideIcon } from 'lucide-react';

interface Props {
  kind: 'project' | 'product';
  ownerName: string;
  subline: string;
  summary: PoolSummary;
  partnersHref: string;
  icons: {
    users: LucideIcon;
    sparkles: LucideIcon;
    globe: LucideIcon;
    languages: LucideIcon;
    barChart: LucideIcon;
  };
}

export function PoolSummaryView({ kind, ownerName, subline, summary, partnersHref, icons }: Props) {
  const Users = icons.users;
  const Sparkles = icons.sparkles;
  const Globe = icons.globe;
  const Languages = icons.languages;
  const BarChart3 = icons.barChart;

  const docTitle = kind === 'project' ? `${ownerName} Project Summary` : `${ownerName} Product Summary`;
  const recipientNoun = kind === 'project' ? 'investor' : 'partner';

  const scoreBands = [
    { label: 'Tier 1 (8–10)', colour: 'text-green-400', barClass: 'bg-green-400' },
    { label: 'Tier 2 (6–7.9)', colour: 'text-blue-400', barClass: 'bg-blue-400' },
    { label: 'Tier 3 (4–5.9)', colour: 'text-amber-400', barClass: 'bg-amber-400' },
    { label: 'Humble (2–3.9)', colour: 'text-dark-400', barClass: 'bg-dark-400' },
  ];
  const visibleScoreDist = summary.score_distribution
    .filter((b) => b.tier <= 4)
    .map((b, i) => ({ ...b, ui: scoreBands[i] }));

  const langTop = summary.language_distribution;

  return (
    <>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 text-dark-500 text-xs uppercase tracking-wide mb-1">
            <BarChart3 className="w-3.5 h-3.5" />
            {kind === 'project' ? 'Project Summary' : 'Product Summary'}
          </div>
          <h1 className="break-words">{docTitle}</h1>
          {subline && <p className="text-dark-400 mt-1">{subline}</p>}
        </div>
        <button
          onClick={() => window.print()}
          className="btn-secondary flex-shrink-0 print:hidden flex items-center gap-2 text-sm"
          title="Print or save as PDF — pass to the sponsor or attach in email"
        >
          <Printer className="w-4 h-4" /> Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Kpi icon={<Users className="w-4 h-4" />} label="Scored" value={summary.totals.discovered} accent="text-white" />
        <Kpi icon={<Sparkles className="w-4 h-4" />} label="In-scope" value={summary.totals.in_scope} accent="text-corp-green-400" />
        <Kpi icon={<Globe className="w-4 h-4" />} label="Regions" value={summary.geographic_distribution.length} accent="text-blue-400" />
        <Kpi icon={<Languages className="w-4 h-4" />} label="Non-English drafts" value={summary.non_english_count} accent="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="card">
          <h3 className="mb-4">Score distribution (in-scope)</h3>
          <div className="space-y-2">
            {visibleScoreDist.map((b) => {
              const max = Math.max(...visibleScoreDist.map((s) => s.count), 1);
              const pct = (b.count / max) * 100;
              return (
                <div key={b.band}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={b.ui.colour}>{b.ui.label}</span>
                    <span className="text-dark-400">{b.count}</span>
                  </div>
                  <div className="h-2 bg-dark-800 rounded overflow-hidden">
                    <div className={`h-full ${b.ui.barClass}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3 className="mb-1 flex items-center gap-2">
            Languages <Languages className="w-4 h-4 text-purple-400" />
          </h3>
          <p className="text-xs text-dark-500 mb-4">
            Every {recipientNoun} receives their first message in their inferred native language — automatic.
          </p>
          <div className="space-y-2">
            {langTop.length === 0 ? (
              <p className="text-sm text-dark-500">No prospects yet.</p>
            ) : (
              langTop.map((l) => {
                const max = Math.max(...langTop.map((x) => x.count), 1);
                const pct = (l.count / max) * 100;
                return (
                  <div key={l.language}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={l.is_english ? 'text-dark-400' : 'text-purple-300'}>{l.language}</span>
                      <span className="text-dark-400">{l.count}</span>
                    </div>
                    <div className="h-2 bg-dark-800 rounded overflow-hidden">
                      <div className={`h-full ${l.is_english ? 'bg-dark-600' : 'bg-purple-500/60'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="card mb-8">
        <h3 className="mb-4 flex items-center gap-2">
          Geographic distribution <Globe className="w-4 h-4 text-blue-400" />
        </h3>
        {summary.geographic_distribution.length === 0 ? (
          <p className="text-sm text-dark-500">No region data yet — run a discovery to populate.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {summary.geographic_distribution.slice(0, 12).map((g) => (
              <div key={g.region} className="px-3 py-2 rounded-lg bg-dark-800 border border-dark-700">
                <div className="text-xs text-dark-500 uppercase tracking-wide">{g.region}</div>
                <div className="text-lg font-semibold">{g.count}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-8">
        <h3 className="mb-4">Top 10 by weighted score</h3>
        {summary.top_prospects.length === 0 ? (
          <p className="text-sm text-dark-500">No in-scope prospects yet.</p>
        ) : (
          <div className="space-y-2">
            {summary.top_prospects.map((p, idx) => (
              <Link
                href={`/partners/${p.id}`}
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 border border-dark-700 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-dark-500 text-xs w-5">{idx + 1}</span>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.contact_name || p.company_name}</div>
                    <div className="text-xs text-dark-500 truncate">
                      {p.contact_name ? `${p.company_name} · ` : ''}
                      {p.category || '(no category)'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.network_distance && (
                    <span className="text-[10px] uppercase tracking-wider text-dark-500">LI {p.network_distance}</span>
                  )}
                  <span className="text-sm font-semibold text-corp-green-400">{p.score?.toFixed(1) ?? '—'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-8 border-corp-green-500/20 bg-corp-green-500/5">
        <h3 className="mb-3 flex items-center gap-2">
          Pool insights <Sparkles className="w-4 h-4 text-corp-green-400" />
        </h3>
        <ul className="space-y-2 text-sm text-dark-200">
          {summary.totals.discovered === 0 ? (
            <li className="text-dark-500">
              {kind === 'project'
                ? 'Run a Find Investors discovery to populate the pool.'
                : 'Run a Find Buyers discovery to populate the pool.'}
            </li>
          ) : (
            <>
              {summary.insights.map((line, i) => (
                <li key={i}>• {line}</li>
              ))}
              <li className="print:hidden">
                •{' '}
                <Link href={partnersHref} className="text-corp-green-400 hover:text-corp-green-300 underline">
                  Open the full prospect list →
                </Link>
              </li>
            </>
          )}
        </ul>
      </div>
    </>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="card py-3">
      <div className="flex items-center gap-1.5 text-xs text-dark-500 uppercase tracking-wide mb-1">
        {icon} {label}
      </div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
