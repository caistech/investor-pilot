/**
 * Pre-score filter for Brave web-search results.
 *
 * Brave queries built from ICP keywords routinely return article-shaped
 * results — listicles ("Top 10 Construction Companies in Australia"),
 * ranking articles ("A Review of the Top X..."), question pages ("What
 * Is Industrial Logistics?"), generic pages ("About", "Company History"),
 * and directory entries ("27 Transport Businesses For Sale"). These are
 * never the actual companies we want to reach — and historically they
 * burned the per-click budget: LLM scoring + Hunter enrichment both
 * fired on them, the scorer marked them out_of_scope, and the row got
 * discarded later in the pipeline anyway.
 *
 * Dropping them BEFORE the scoring + Hunter calls saves the budget for
 * actual in-scope candidates. Operator flagged 2026-05-19: "thousands of
 * businesses that should match my ICP that I'm scrabbling for 10 and
 * 20 of". The 150 raw-candidate cap is a Vercel-timeout artefact;
 * stopping the waste on guaranteed-junk results 2-3x's actionable yield
 * without lifting any limit.
 *
 * Composed with isPublisherDomain() in the filter chain — publisher-
 * domain catches "this is the Wall Street Journal", junk-result catches
 * "this is a listicle on a non-publisher domain".
 */

import { looksLikeJunkCompanyName } from './clean-company-name';

const JUNK_TITLE_PATTERNS: RegExp[] = [
  // Listicles + ranking articles: "Top 10 X", "Best 5 Y", "Largest N",
  // "15 Family-Owned Trucking Companies", "27 Transport Businesses".
  // Number-prefix is a strong listicle signal even without "top/best".
  /^\s*\d+\s+[A-Z]/,
  /\b(top|best|largest|biggest|leading|finest)\s+\d+/i,
  /\b\d+\s+(top|best|biggest|leading|family[\s-]owned)\b/i,

  // Ranking-style: "A Review of...", "Australia's Top X", "Guide to X".
  /^a\s+(review|guide|comprehensive|brief|complete|definitive)\s+(of|to)/i,
  /^(.+'?s\s+)?(top|largest|best|biggest|leading)\s+\d*/i,

  // Question titles: "What Is...", "How to...", "Why X", "Does X...".
  /^(what|how|why|when|where|which|who|does|do|is|are|can|should|will)\s+(is|to|do|are|the|you|i|we|a|an)\b/i,

  // Generic page titles: "About Us", "Contact", "Home Page",
  // "Company History", "Our Story", "News".
  /^(company\s+history|about(\s+us)?|contact(\s+us)?|home(\s+page)?|our\s+(history|story|team|services|company)|services?|products?|portfolio|team|news|blog|case\s+stud(ies|y))\s*$/i,

  // Marketing fillers: "X Can Help Your Business Grow",
  // "The Role of X in Y", "X: A Journey...".
  /\b(can\s+help|will\s+help|helping)\s+(your|you)\b/i,
  /^the\s+role\s+of\s+/i,
  /journey\s+of|story\s+of|history\s+of|guide\s+to|introduction\s+to/i,

  // Government / grant / regulatory titles — never a company.
  /\b(government|grant|legislation|regulation|act|policy|gazette)\b.*\$\d/i,
  /\bhow\s+to\s+get\b/i,
];

const JUNK_URL_PATH_PATTERNS: RegExp[] = [
  // Editorial paths — the URL itself betrays an article.
  /\/blog\//i,
  /\/blogs?\//i,
  /\/news\//i,
  /\/articles?\//i,
  /\/insights?\//i,
  /\/case[-_\s]?stud(y|ies)\//i,
  /\/resources?\//i,
  /\/whitepapers?\//i,
  /\/reports?\//i,
  /\/press[-_\s]?(release|room|coverage)\//i,
  /\/learn\//i,
  /\/guides?\//i,
  /\/posts?\//i,

  // Listing / directory paths.
  /\/companies?\/[a-z0-9-]+\/?$/i,    // /companies/something — directory page
  /\/business(es)?[-_\s]?for[-_\s]?sale/i,
  /\/(listings?|directory|search|tag|tags|category|categories)\//i,
];

/**
 * Returns true when the Brave result's title or URL strongly suggests
 * an article / listicle / generic-page rather than a real company.
 * False positives are acceptable here — a borderline article that
 * mentions a real company in its title is rare, and the cost of
 * skipping it (one missed lead) is much smaller than the cost of
 * scoring + Hunter-enriching it (junk row in Prospects).
 */
export function looksLikeJunkBraveResult(title: string | null | undefined, url: string | null | undefined): boolean {
  const t = (title || '').trim();
  if (!t) return true; // no title = no signal

  // Title patterns: cheapest check, run first.
  for (const p of JUNK_TITLE_PATTERNS) {
    if (p.test(t)) return true;
  }

  // Reuse the existing junk-name detector — handles pipe-stacked
  // SEO titles, "Family-Owned X Company" descriptors, and the rest
  // of the patterns in clean-company-name.ts.
  if (looksLikeJunkCompanyName(t)) return true;

  // URL paths: catches editorial paths even when the title's tame.
  if (url) {
    try {
      const u = new URL(url);
      const path = u.pathname;
      for (const p of JUNK_URL_PATH_PATTERNS) {
        if (p.test(path)) return true;
      }
    } catch {
      // Malformed URL — treat as junk; nothing reachable.
      return true;
    }
  }

  return false;
}
