/**
 * Shared aggregation for the auto-generated Pool Summary deliverable
 * (`{Project Name} Project Summary` for raises, `{Product Name} Product
 * Summary` for sales). Pure aggregation — no DB queries, no LLM calls —
 * so it can run server-side from API routes AND directly from SSR pages
 * without the http round-trip.
 *
 * Single source of truth for REGION_PATTERNS / LANGUAGE_BY_REGION /
 * SECTOR_PATTERNS — these used to live duplicated in the route + the
 * page, which meant adding a new region required updating both.
 */

export interface PoolPartner {
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
}

export interface PoolSummary {
  totals: {
    discovered: number;
    in_scope: number;
    out_of_scope: number;
    by_status: Record<string, number>;
    by_source: Record<string, number>;
    by_network_distance: Record<string, number>;
  };
  score_distribution: Array<{ band: string; count: number; tier: 1 | 2 | 3 | 4 | 5 }>;
  geographic_distribution: Array<{ region: string; count: number }>;
  sector_distribution: Array<{ sector: string; count: number }>;
  language_distribution: Array<{ language: string; count: number; is_english: boolean }>;
  top_prospects: Array<{
    id: string;
    company_name: string;
    contact_name: string | null;
    score: number | null;
    category: string | null;
    network_distance: string | null;
  }>;
  insights: string[];
  non_english_count: number;
  top_region: { region: string; count: number } | null;
}

export const REGION_PATTERNS: Array<[RegExp, string]> = [
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

export const LANGUAGE_BY_REGION: Record<string, string> = {
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

export const SECTOR_PATTERNS: Array<[RegExp, string]> = [
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

const SCORE_BANDS: Array<{ band: string; tier: 1 | 2 | 3 | 4 | 5; test: (s: number) => boolean }> = [
  { band: '8.0–10.0 (tier 1)', tier: 1, test: (s) => s >= 8 },
  { band: '6.0–7.9 (tier 2)', tier: 2, test: (s) => s >= 6 && s < 8 },
  { band: '4.0–5.9 (tier 3)', tier: 3, test: (s) => s >= 4 && s < 6 },
  { band: '2.0–3.9 (humble)', tier: 4, test: (s) => s >= 2 && s < 4 },
  { band: 'Below 2 (rejected)', tier: 5, test: (s) => s < 2 },
];

function regionFor(text: string): string | null {
  for (const [pattern, label] of REGION_PATTERNS) if (pattern.test(text)) return label;
  return null;
}

function sectorFor(text: string): string | null {
  for (const [pattern, label] of SECTOR_PATTERNS) if (pattern.test(text)) return label;
  return null;
}

/**
 * Compute the full Pool Summary from a list of partners. Works for both
 * project (investor) pools and product (sales partner) pools — the
 * recipient language is "investor" vs "partner" but the aggregation is
 * the same shape.
 */
export function computePoolSummary(
  partners: PoolPartner[],
  context: { kind: 'project' | 'product' },
): PoolSummary {
  const inScope = partners.filter((p) => !/out[_ -]?of[_ -]?scope/i.test(p.category || ''));
  const outOfScope = partners.length - inScope.length;

  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byNetwork: Record<string, number> = {};
  for (const p of partners) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    if (p.source) bySource[p.source] = (bySource[p.source] || 0) + 1;
    if (p.network_distance) byNetwork[p.network_distance] = (byNetwork[p.network_distance] || 0) + 1;
  }

  const score_distribution = SCORE_BANDS.map((b) => ({
    band: b.band,
    tier: b.tier,
    count: inScope.filter((p) => p.weighted_score !== null && b.test(p.weighted_score)).length,
  }));

  const geoCounts: Record<string, number> = {};
  const sectorCounts: Record<string, number> = {};
  const langCounts: Record<string, number> = {};
  for (const p of inScope) {
    const haystack = [p.category, p.audience_overlap_notes, p.complementarity_notes, p.partner_readiness_notes]
      .filter((x): x is string => !!x)
      .join(' ');
    const region = regionFor(haystack);
    if (region) geoCounts[region] = (geoCounts[region] || 0) + 1;
    const sector = sectorFor(haystack);
    if (sector) sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    const lang = region ? LANGUAGE_BY_REGION[region] || 'English' : 'English / Unspecified';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }
  const geographic_distribution = Object.entries(geoCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ region, count }));
  const sector_distribution = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([sector, count]) => ({ sector, count }));
  const language_distribution = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => ({
      language,
      count,
      is_english: language === 'English' || language === 'English / Unspecified',
    }));

  const top_prospects = inScope.slice(0, 10).map((p) => ({
    id: p.id,
    company_name: p.company_name,
    contact_name: p.contact_name,
    score: p.weighted_score,
    category: p.category,
    network_distance: p.network_distance,
  }));

  const nonEnglishLangs = language_distribution.filter((l) => !l.is_english);
  const non_english_count = nonEnglishLangs.reduce((acc, l) => acc + l.count, 0);
  const top_region = geographic_distribution[0] || null;

  const insights: string[] = [];
  const recipientNoun = context.kind === 'project' ? 'investor' : 'partner';
  if (partners.length > 0) {
    insights.push(
      `${partners.length} ${recipientNoun}s scored — ${inScope.length} in-scope, ${outOfScope} correctly filtered out_of_scope.`,
    );
  }
  if (top_region) {
    insights.push(
      `Top region: ${top_region.region} (${top_region.count} ${recipientNoun}s, ${Math.round(
        (top_region.count / Math.max(inScope.length, 1)) * 100,
      )}% of in-scope pool).`,
    );
  }
  if (non_english_count > 0) {
    insights.push(
      `${non_english_count} ${recipientNoun}s (${Math.round(
        (non_english_count / Math.max(inScope.length, 1)) * 100,
      )}%) will receive their first message in their native language — ` +
        nonEnglishLangs
          .slice(0, 3)
          .map((l) => `${l.count} ${l.language}`)
          .join(', ') +
        (nonEnglishLangs.length > 3 ? `, +${nonEnglishLangs.length - 3} more` : '') +
        '.',
    );
  }
  const tier1Count = score_distribution[0]?.count || 0;
  const tier2Count = score_distribution[1]?.count || 0;
  if (tier1Count + tier2Count > 0) {
    insights.push(
      `${tier1Count + tier2Count} high-confidence drafts available right now (score ≥ 6.0). ${tier1Count} will render with specific named-deal evidence (tier 1).`,
    );
  }
  const linkedinFirstCount = byNetwork['1st'] || 0;
  const linkedinFirstShare = inScope.length > 0 ? Math.round((linkedinFirstCount / inScope.length) * 100) : 0;
  if (linkedinFirstShare >= 10) {
    insights.push(
      `${linkedinFirstCount} ${recipientNoun}s (${linkedinFirstShare}%) are LinkedIn 1st-degree — warm-DM cadence applies, no connect step needed.`,
    );
  }

  return {
    totals: {
      discovered: partners.length,
      in_scope: inScope.length,
      out_of_scope: outOfScope,
      by_status: byStatus,
      by_source: bySource,
      by_network_distance: byNetwork,
    },
    score_distribution,
    geographic_distribution,
    sector_distribution,
    language_distribution,
    top_prospects,
    insights,
    non_english_count,
    top_region,
  };
}

/**
 * Compact one-liner summary suitable for project/product list rows. e.g.
 * "35 scored · 12 non-English · top: Vietnam". Falls back gracefully on
 * empty pools.
 */
export function summaryHeadline(s: PoolSummary): string {
  if (s.totals.discovered === 0) return 'No prospects yet';
  const parts: string[] = [`${s.totals.in_scope} scored`];
  if (s.non_english_count > 0) parts.push(`${s.non_english_count} non-English`);
  if (s.top_region) parts.push(`top: ${s.top_region.region}`);
  return parts.join(' · ');
}
