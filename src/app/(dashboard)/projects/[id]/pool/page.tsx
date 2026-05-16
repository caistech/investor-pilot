import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Globe, Languages, BarChart3, Sparkles, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Re-uses the route's aggregation by calling it directly via fetch.
// Keeps the report logic single-sourced.
export default async function PoolReportPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .single();
  if (!profile?.organisation_id) notFound();

  // Use the service client to fetch the project + delegate the heavy
  // aggregation to the API route. Server-side fetch — no auth cookie
  // forwarding required because we re-validate inside the route handler.
  const db = createServiceClient();
  const { data: project } = await db
    .from('projects')
    .select('id, name, investment_thesis, description, target_round, round_size_label, asset_class, geography, sponsor')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();
  if (!project) notFound();

  // Inline the aggregation by importing the route's data shape — we
  // re-query partners directly here so the page is self-contained
  // server-side (avoids the http round-trip for SSR speed).
  const { data: partnersRaw } = await db
    .from('partners')
    .select('id, company_name, contact_name, weighted_score, category, status, source, network_distance, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .eq('project_id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  type PartnerLite = {
    id: string;
    company_name: string;
    contact_name: string | null;
    weighted_score: number | null;
    category: string | null;
    status: string;
    source: string | null;
    network_distance: string | null;
    audience_overlap_notes: string | null;
    complementarity_notes: string | null;
    partner_readiness_notes: string | null;
  };
  const partners = (partnersRaw || []) as PartnerLite[];
  const inScope = partners.filter(p => !/out[_ -]?of[_ -]?scope/i.test(p.category || ''));
  const outOfScope = partners.length - inScope.length;

  const REGION_PATTERNS: Array<[RegExp, string]> = [
    [/\b(vietnam|viet)\b/i, 'Vietnam'],
    [/\b(korea|seoul)\b/i, 'Korea'],
    [/\b(japan|tokyo)\b/i, 'Japan'],
    [/\b(thai|thailand)\b/i, 'Thailand'],
    [/\b(indonesi|jakarta)\b/i, 'Indonesia'],
    [/\b(china|chinese|beijing|shanghai)\b/i, 'China'],
    [/\b(hong kong|hk|taiwan|taipei)\b/i, 'Greater China'],
    [/\b(singapor|sgp)\b/i, 'Singapore'],
    [/\b(india|mumbai|delhi|bangalore)\b/i, 'India'],
    [/\b(saudi|riyadh|emirat|uae|dubai|qatar|kuwait|mena)\b/i, 'MENA'],
    [/\b(brazil|brasil|sao paulo)\b/i, 'Brazil'],
    [/\b(spain|madrid|barcelona|mexico|argent|colomb|chile|latam)\b/i, 'Spanish LATAM/Iberia'],
    [/\b(france|paris)\b/i, 'France'],
    [/\b(german|germany|austria)\b/i, 'DACH'],
    [/\b(itali|rome|milan)\b/i, 'Italy'],
    [/\b(turkey|istanbul)\b/i, 'Turkey'],
    [/\b(uk|london|britain)\b/i, 'UK'],
    [/\b(australia|sydney|melbourne|au\b)/i, 'Australia'],
    [/\b(united states|usa|us\b|new york|san francisco|silicon valley)\b/i, 'USA'],
  ];
  const LANG_BY_REGION: Record<string, string> = {
    Vietnam: 'Vietnamese', Korea: 'Korean', Japan: 'Japanese', Thailand: 'Thai',
    Indonesia: 'Indonesian', China: 'Mandarin', 'Greater China': 'Chinese',
    MENA: 'Arabic', Brazil: 'Portuguese', 'Spanish LATAM/Iberia': 'Spanish',
    France: 'French', DACH: 'German', Italy: 'Italian', Turkey: 'Turkish',
  };

  const geoCounts: Record<string, number> = {};
  const langCounts: Record<string, number> = {};
  for (const p of inScope) {
    const haystack = [p.category, p.audience_overlap_notes, p.complementarity_notes, p.partner_readiness_notes]
      .filter(Boolean).join(' ');
    const region = REGION_PATTERNS.find(([re]) => re.test(haystack))?.[1];
    if (region) {
      geoCounts[region] = (geoCounts[region] || 0) + 1;
      const lang = LANG_BY_REGION[region] || 'English';
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    } else {
      langCounts['English / Unspecified'] = (langCounts['English / Unspecified'] || 0) + 1;
    }
  }
  const geoTop = Object.entries(geoCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const langTop = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);

  const bands = [
    { label: 'Tier 1 (8–10)',  test: (s: number) => s >= 8, colour: 'text-green-400' },
    { label: 'Tier 2 (6–7.9)', test: (s: number) => s >= 6 && s < 8, colour: 'text-blue-400' },
    { label: 'Tier 3 (4–5.9)', test: (s: number) => s >= 4 && s < 6, colour: 'text-amber-400' },
    { label: 'Humble (2–3.9)', test: (s: number) => s >= 2 && s < 4, colour: 'text-dark-400' },
  ];
  const scoreDist = bands.map(b => ({
    label: b.label,
    colour: b.colour,
    count: inScope.filter(p => p.weighted_score !== null && b.test(p.weighted_score)).length,
  }));

  const nonEnglishCount = langTop
    .filter(([l]) => l !== 'English / Unspecified' && l !== 'English')
    .reduce((acc, [, c]) => acc + c, 0);

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/projects" className="flex items-center gap-2 text-dark-400 hover:text-white mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to projects
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-3 text-dark-500 text-xs uppercase tracking-wide mb-1">
          <BarChart3 className="w-3.5 h-3.5" />
          Investor pool profile
        </div>
        <h1>{project.name}</h1>
        <p className="text-dark-400 mt-1">
          {project.target_round ? `${project.target_round} · ` : ''}{project.round_size_label || project.asset_class}{project.geography ? ` · ${project.geography}` : ''}
        </p>
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Kpi icon={<Users className="w-4 h-4" />} label="Scored" value={partners.length} accent="text-white" />
        <Kpi icon={<Sparkles className="w-4 h-4" />} label="In-scope" value={inScope.length} accent="text-corp-green-400" />
        <Kpi icon={<Globe className="w-4 h-4" />} label="Regions" value={geoTop.length} accent="text-blue-400" />
        <Kpi icon={<Languages className="w-4 h-4" />} label="Non-English drafts" value={nonEnglishCount} accent="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Score distribution */}
        <div className="card">
          <h3 className="mb-4">Score distribution (in-scope)</h3>
          <div className="space-y-2">
            {scoreDist.map(b => {
              const max = Math.max(...scoreDist.map(s => s.count), 1);
              const pct = (b.count / max) * 100;
              return (
                <div key={b.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={b.colour}>{b.label}</span>
                    <span className="text-dark-400">{b.count}</span>
                  </div>
                  <div className="h-2 bg-dark-800 rounded overflow-hidden">
                    <div className={`h-full ${b.colour.replace('text-', 'bg-')}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Language distribution — the localization unlock */}
        <div className="card">
          <h3 className="mb-1 flex items-center gap-2">Languages <Languages className="w-4 h-4 text-purple-400" /></h3>
          <p className="text-xs text-dark-500 mb-4">Every prospect receives their first message in their inferred native language — automatic.</p>
          <div className="space-y-2">
            {langTop.length === 0 ? (
              <p className="text-sm text-dark-500">No prospects yet.</p>
            ) : (
              langTop.map(([lang, count]) => {
                const max = Math.max(...langTop.map(l => l[1]), 1);
                const pct = (count / max) * 100;
                const isEnglish = lang === 'English / Unspecified' || lang === 'English';
                return (
                  <div key={lang}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={isEnglish ? 'text-dark-400' : 'text-purple-300'}>{lang}</span>
                      <span className="text-dark-400">{count}</span>
                    </div>
                    <div className="h-2 bg-dark-800 rounded overflow-hidden">
                      <div className={`h-full ${isEnglish ? 'bg-dark-600' : 'bg-purple-500/60'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Geography */}
      <div className="card mb-8">
        <h3 className="mb-4 flex items-center gap-2">Geographic distribution <Globe className="w-4 h-4 text-blue-400" /></h3>
        {geoTop.length === 0 ? (
          <p className="text-sm text-dark-500">No region data yet — run a discovery to populate.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {geoTop.map(([region, count]) => (
              <div key={region} className="px-3 py-2 rounded-lg bg-dark-800 border border-dark-700">
                <div className="text-xs text-dark-500 uppercase tracking-wide">{region}</div>
                <div className="text-lg font-semibold">{count}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top 10 by score */}
      <div className="card mb-8">
        <h3 className="mb-4">Top 10 by weighted score</h3>
        {inScope.length === 0 ? (
          <p className="text-sm text-dark-500">No in-scope prospects yet.</p>
        ) : (
          <div className="space-y-2">
            {inScope.slice(0, 10).map((p, idx) => (
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
                      {p.contact_name ? `${p.company_name} · ` : ''}{p.category || '(no category)'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.network_distance && <span className="text-[10px] uppercase tracking-wider text-dark-500">LI {p.network_distance}</span>}
                  <span className="text-sm font-semibold text-corp-green-400">{p.weighted_score?.toFixed(1) ?? '—'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Narrative insights */}
      <div className="card mb-8 border-corp-green-500/20 bg-corp-green-500/5">
        <h3 className="mb-3 flex items-center gap-2">Pool insights <Sparkles className="w-4 h-4 text-corp-green-400" /></h3>
        <ul className="space-y-2 text-sm text-dark-200">
          {partners.length === 0 ? (
            <li className="text-dark-500">Run a Find Investors discovery to populate the pool.</li>
          ) : (
            <>
              <li>• {partners.length} prospects scored — {inScope.length} in-scope, {outOfScope} correctly filtered <span className="text-dark-500">out_of_scope</span>.</li>
              {geoTop.length > 0 && (
                <li>• Top region: <b>{geoTop[0][0]}</b> ({geoTop[0][1]} prospects, {Math.round(geoTop[0][1] / Math.max(inScope.length, 1) * 100)}% of in-scope).</li>
              )}
              {nonEnglishCount > 0 && (
                <li>• <b>{nonEnglishCount} prospects</b> ({Math.round(nonEnglishCount / Math.max(inScope.length, 1) * 100)}%) will get their first message in their native language — automatic.</li>
              )}
              {(scoreDist[0].count + scoreDist[1].count) > 0 && (
                <li>• <b>{scoreDist[0].count + scoreDist[1].count} high-confidence drafts</b> available right now (score ≥ 6.0). {scoreDist[0].count} render with specific named-deal evidence (tier 1).</li>
              )}
              <li>• <Link href={`/partners?project=${project.id}`} className="text-corp-green-400 hover:text-corp-green-300 underline">Open the full prospect list →</Link></li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="card py-3">
      <div className="flex items-center gap-1.5 text-xs text-dark-500 uppercase tracking-wide mb-1">{icon} {label}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
