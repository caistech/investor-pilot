/**
 * GET /api/projects/[id]/pool-report
 *
 * Auto-generated market-research summary of the investor pool surfaced
 * for a project. Reads from the partners table (no extra DB work, no
 * LLM call — pure aggregation) and returns:
 *
 *   - Total scored / by status
 *   - Score distribution (histogram)
 *   - Geographic distribution (parsed from partner.category text)
 *   - Sector distribution (parsed from partner.category text)
 *   - Localization map (how many prospects will receive each language)
 *   - Top 10 by score with one-line summaries
 *
 * This is the "discovery shipped → market research is an output" unlock.
 * Operator can hand this to the project sponsor as a one-page profile
 * of who's been surfaced — useful for diligence even before any
 * outreach goes out.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export const dynamic = 'force-dynamic';

export interface PoolReport {
  project_id: string;
  project_name: string;
  generated_at: string;
  totals: {
    discovered: number;
    in_scope: number;
    out_of_scope: number;
    by_status: Record<string, number>;
    by_source: Record<string, number>;
    by_network_distance: Record<string, number>;
  };
  score_distribution: Array<{ band: string; count: number }>;
  geographic_distribution: Array<{ region: string; count: number }>;
  sector_distribution: Array<{ sector: string; count: number }>;
  language_distribution: Array<{ language: string; count: number }>;
  top_prospects: Array<{
    id: string;
    company_name: string;
    contact_name: string | null;
    score: number | null;
    category: string | null;
    network_distance: string | null;
  }>;
  insights: string[];
}

const REGION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(vietnam|viet|hanoi|ho chi minh)\b/i, 'Vietnam'],
  [/\b(korea|seoul)\b/i, 'Korea'],
  [/\b(japan|tokyo|osaka)\b/i, 'Japan'],
  [/\b(thai|thailand|bangkok)\b/i, 'Thailand'],
  [/\b(indonesi|jakarta)\b/i, 'Indonesia'],
  [/\b(china|chinese|beijing|shanghai|shenzhen)\b/i, 'China (mainland)'],
  [/\b(hong kong|hk)\b/i, 'Hong Kong'],
  [/\b(taiwan|taipei)\b/i, 'Taiwan'],
  [/\b(singapor|sgp)\b/i, 'Singapore'],
  [/\b(malaysia|kuala lumpur)\b/i, 'Malaysia'],
  [/\b(philippines|manila)\b/i, 'Philippines'],
  [/\b(india|mumbai|delhi|bangalore|bengaluru)\b/i, 'India'],
  [/\b(saudi|riyadh|jeddah|emirat|uae|dubai|abu dhabi|qatar|doha|kuwait|bahrain|oman|mena)\b/i, 'MENA'],
  [/\b(brazil|brasil|sao paulo|rio de janeiro)\b/i, 'Brazil'],
  [/\b(mexico|mexican)\b/i, 'Mexico'],
  [/\b(spain|madrid|barcelona)\b/i, 'Spain'],
  [/\b(argent|colomb|chile|santiago|peru|lima|latam)\b/i, 'LATAM (rest)'],
  [/\b(france|paris|french)\b/i, 'France'],
  [/\b(german|germany|berlin|munich|frankfurt|austria|vienna)\b/i, 'DACH'],
  [/\b(itali|rome|milan)\b/i, 'Italy'],
  [/\b(turkey|turkish|istanbul)\b/i, 'Turkey'],
  [/\b(russia|moscow)\b/i, 'Russia'],
  [/\b(uk|london|britain|english)\b/i, 'UK'],
  [/\b(australia|sydney|melbourne|brisbane|au\b)/i, 'Australia'],
  [/\b(united states|usa|us\b|new york|san francisco|sf\b|silicon valley|nyc|bay area)\b/i, 'USA'],
  [/\b(canada|toronto|vancouver)\b/i, 'Canada'],
];

const LANGUAGE_BY_REGION: Record<string, string> = {
  Vietnam: 'Vietnamese',
  Korea: 'Korean',
  Japan: 'Japanese',
  Thailand: 'Thai',
  Indonesia: 'Indonesian',
  'China (mainland)': 'Simplified Chinese',
  'Hong Kong': 'Traditional Chinese',
  Taiwan: 'Traditional Chinese',
  MENA: 'Arabic',
  Brazil: 'Brazilian Portuguese',
  Mexico: 'Spanish',
  Spain: 'Spanish',
  'LATAM (rest)': 'Spanish',
  France: 'French',
  DACH: 'German',
  Italy: 'Italian',
  Turkey: 'Turkish',
  Russia: 'Russian',
};

const SECTOR_PATTERNS: Array<[RegExp, string]> = [
  [/\b(b2b saas|saas|software-as-a-service)\b/i, 'B2B SaaS'],
  [/\b(edtech|education|learning|l&d|workforce|training)\b/i, 'EdTech / L&D'],
  [/\b(fintech|finance|banking|payments)\b/i, 'Fintech'],
  [/\b(healthtech|health|medtech|biotech)\b/i, 'Health / Bio'],
  [/\b(ai\b|artificial intelligence|machine learning|ml\b|llm)\b/i, 'AI / ML'],
  [/\b(climate|cleantech|sustainab|energy|esg)\b/i, 'Climate / Energy'],
  [/\b(consumer|d2c|dtc|marketplace|ecommerce|retail)\b/i, 'Consumer / D2C'],
  [/\b(b2b|enterprise)\b/i, 'B2B (other)'],
  [/\b(prop[\s-]?tech|real estate|construction|build)\b/i, 'PropTech / Real Estate'],
  [/\b(deep[\s-]?tech|robot|hardware|semi)\b/i, 'Deep tech / Hardware'],
];

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: project } = await db
    .from('projects')
    .select('id, name, organisation_id')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Pull every partner discovered for this project. Service client is
  // already org-scoped by the project lookup above.
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

  // --- Totals ---
  const inScope = partners.filter(p => !/out[_ -]?of[_ -]?scope/i.test(p.category || ''));
  const outOfScope = partners.length - inScope.length;
  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byNetwork: Record<string, number> = {};
  for (const p of partners) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    if (p.source) bySource[p.source] = (bySource[p.source] || 0) + 1;
    if (p.network_distance) byNetwork[p.network_distance] = (byNetwork[p.network_distance] || 0) + 1;
  }

  // --- Score distribution (in-scope only) ---
  const bands = [
    { label: '8.0–10.0 (tier 1)', test: (s: number) => s >= 8 },
    { label: '6.0–7.9 (tier 2)',  test: (s: number) => s >= 6 && s < 8 },
    { label: '4.0–5.9 (tier 3)',  test: (s: number) => s >= 4 && s < 6 },
    { label: '2.0–3.9 (humble)',  test: (s: number) => s >= 2 && s < 4 },
    { label: 'Below 2 (rejected)', test: (s: number) => s < 2 },
  ];
  const scoreDistribution = bands.map(b => ({
    band: b.label,
    count: inScope.filter(p => p.weighted_score !== null && b.test(p.weighted_score)).length,
  }));

  // --- Geographic + sector + language distribution (pattern-match on category + notes) ---
  function regionFor(text: string): string | null {
    for (const [pattern, label] of REGION_PATTERNS) if (pattern.test(text)) return label;
    return null;
  }
  function sectorFor(text: string): string | null {
    for (const [pattern, label] of SECTOR_PATTERNS) if (pattern.test(text)) return label;
    return null;
  }
  const geoCounts: Record<string, number> = {};
  const sectorCounts: Record<string, number> = {};
  const langCounts: Record<string, number> = {};
  for (const p of inScope) {
    const haystack = [p.category, p.audience_overlap_notes, p.complementarity_notes, p.partner_readiness_notes]
      .filter((x): x is string => !!x).join(' ');
    const region = regionFor(haystack);
    if (region) geoCounts[region] = (geoCounts[region] || 0) + 1;
    const sector = sectorFor(haystack);
    if (sector) sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    const lang = region ? (LANGUAGE_BY_REGION[region] || 'English') : 'Unknown';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }
  const geographicDistribution = Object.entries(geoCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ region, count }));
  const sectorDistribution = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([sector, count]) => ({ sector, count }));
  const languageDistribution = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => ({ language, count }));

  // --- Top 10 by score ---
  const topProspects = inScope.slice(0, 10).map(p => ({
    id: p.id,
    company_name: p.company_name,
    contact_name: p.contact_name,
    score: p.weighted_score,
    category: p.category,
    network_distance: p.network_distance,
  }));

  // --- Insights (templated narrative) ---
  const insights: string[] = [];
  if (partners.length > 0) {
    insights.push(`${partners.length} prospects scored — ${inScope.length} in-scope, ${outOfScope} correctly filtered out_of_scope.`);
  }
  if (geographicDistribution.length > 0) {
    const topGeo = geographicDistribution[0];
    insights.push(`Top region: ${topGeo.region} (${topGeo.count} prospects, ${Math.round(topGeo.count / Math.max(inScope.length, 1) * 100)}% of in-scope pool).`);
  }
  const nonEnglishLangs = languageDistribution.filter(l => l.language !== 'English' && l.language !== 'Unknown');
  const nonEnglishCount = nonEnglishLangs.reduce((acc, l) => acc + l.count, 0);
  if (nonEnglishCount > 0) {
    insights.push(
      `${nonEnglishCount} prospects (${Math.round(nonEnglishCount / Math.max(inScope.length, 1) * 100)}%) will receive their first message in their native language — `
      + nonEnglishLangs.slice(0, 3).map(l => `${l.count} ${l.language}`).join(', ')
      + (nonEnglishLangs.length > 3 ? `, +${nonEnglishLangs.length - 3} more` : '')
      + '.'
    );
  }
  const tier1Count = scoreDistribution[0]?.count || 0;
  const tier2Count = scoreDistribution[1]?.count || 0;
  if (tier1Count + tier2Count > 0) {
    insights.push(`${tier1Count + tier2Count} high-confidence drafts available right now (score ≥ 6.0). ${tier1Count} will render with specific named-deal evidence (tier 1).`);
  }
  const linkedinPct = byNetwork['1st'] || 0;
  const linkedinFirstShare = inScope.length > 0 ? Math.round(linkedinPct / inScope.length * 100) : 0;
  if (linkedinFirstShare >= 10) {
    insights.push(`${linkedinPct} prospects (${linkedinFirstShare}%) are LinkedIn 1st-degree — warm-DM cadence applies, no connect step needed.`);
  }

  const report: PoolReport = {
    project_id: project.id,
    project_name: project.name,
    generated_at: new Date().toISOString(),
    totals: {
      discovered: partners.length,
      in_scope: inScope.length,
      out_of_scope: outOfScope,
      by_status: byStatus,
      by_source: bySource,
      by_network_distance: byNetwork,
    },
    score_distribution: scoreDistribution,
    geographic_distribution: geographicDistribution,
    sector_distribution: sectorDistribution,
    language_distribution: languageDistribution,
    top_prospects: topProspects,
    insights,
  };

  return NextResponse.json(report);
}
