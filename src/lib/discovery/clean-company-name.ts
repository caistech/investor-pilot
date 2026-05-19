/**
 * Normalise a scraped company_name string.
 *
 * Brave search results frequently surface page titles as the "company
 * name" because that's the most readable string the SERP returns. Page
 * titles carry contamination — site brand suffixes, SEO keyword stacks,
 * pipe-delimited multi-mentions, generic webpage headings. When these
 * land in partner.company_name, the renderer either:
 *   - shows them verbatim to the recipient ("Hi Mina at Renovation Builders
 *     Sydney|Civil Construction Companies Sydney|Remedial Building Sydney"
 *     — obvious template signal)
 *   - or the LLM "helpfully" invents a plausible-looking clean name
 *     instead ("Everest"), which is a worse failure mode because
 *     recipients see a fabricated identity for their own firm.
 *
 * This module gives discovery + render a single place to clean and a
 * single place to detect "this name is still garbage; refuse rather
 * than send".
 *
 * Operator flagged 2026-05-19 after Mina's draft was addressed to a
 * hallucinated "Everest" — the underlying company_name was a scraped
 * pipe-delimited title and the LLM substituted a fake clean name.
 */

/**
 * Indicators a string is a scraped page title, not a real company name.
 * Used to gate render — if the cleaned name still matches, refuse.
 */
const JUNK_NAME_PATTERNS: RegExp[] = [
  // Pure heading-style ("Company History", "About Us", "Contact",
  // "Home Page"). Real company names rarely match these standalone.
  /^(company\s*history|about\s*(us)?|contact(\s*us)?|home(\s*page)?|services?|products?|portfolio|team|news|blog|case\s*stud(ies|y))$/i,

  // SEO keyword stack — multiple separators, no clear primary entity.
  // E.g. "Construction Sydney | Civil Construction Companies Sydney"
  // (3+ pipe-separated segments, each one a keyword-style fragment).
  /^[^|]+\|[^|]+\|[^|]+/,

  // Multiple sentences with "and" stacking ("A Journey of Success and
  // Evolution"-style marketing prose).
  /journey of|story of|history of|guide to|introduction to/i,

  // Ranking-style article titles ("Australia's Top 10 Construction
  // Companies", "Largest Family-Owned Enterprises in Australia", "Best
  // X in Y"). Not company names — listicle articles.
  /^(.+'?s\s+)?(top|largest|best|biggest|leading)\s+\d*/i,

  // Generic descriptors with no proper noun anchor.
  /^(your|the)\s+\w+\s+(experts?|solutions?|specialists?|leaders?)\s*$/i,

  // Family-owned descriptors without a brand anchor ("Family-Owned
  // Logistics and Transport Company" — describes a category, not a
  // company). When a real family-owned company name appears, the brand
  // is the first word ("Lipman Family Construction"), not the descriptor.
  /^family[\s-]?owned\s+\w+(\s+\w+){0,5}\s+company$/i,

  // News headline cadence — present-tense verbs, very long, sentence-like.
  // E.g. "Australia's oldest family owned logistics company powers on
  // with new fleet of Kenworths". Real company names rarely contain
  // these verbs.
  /\b(powers|wins|celebrates|launches|expands|announces|acquires|partners with|secures|reveals)\s+\w/i,
];

/**
 * Suffixes a real company name might carry that we strip:
 *   "ADCO I Builder of Choice" → "ADCO"
 *   "Lipman - Sydney Builders" → "Lipman"
 *   "The Golden Group: A Journey of Success and Evolution" → "The Golden Group"
 *
 * Conservative — we only strip after the FIRST separator if what's
 * before it looks like a real name (≥2 chars, contains a letter).
 */
// Separator must have whitespace on AT LEAST ONE side, otherwise we'd
// mangle hyphenated compound names ("Electro-Spec Industries" stripped
// to "Electro"). The " I " (capital I as separator) form needs
// whitespace on both sides — common in scraped titles like "ADCO I
// Builder of Choice".
const SUFFIX_SEPARATORS = /\s+[\-:|·•]\s*|\s*[\-:|·•]\s+|\s+I\s+/;

export interface CleanedName {
  /** The cleaned name, or null if nothing salvageable remained. */
  cleaned: string | null;
  /** True when the original was already clean (no normalisation needed). */
  was_clean: boolean;
  /** Whatever the original looked like — preserved so callers can log. */
  original: string;
  /** True when the cleaned result is STILL junk-shaped and should not be sent. */
  still_junk: boolean;
}

export function cleanCompanyName(raw: string | null | undefined): CleanedName {
  const original = (raw ?? '').toString();
  if (!original.trim()) {
    return { cleaned: null, was_clean: false, original, still_junk: true };
  }

  let work = original.trim();

  // Strip trailing whitespace, repeated spaces, smart quotes that
  // sometimes ride along on scraped titles.
  work = work.replace(/\s+/g, ' ').replace(/[‘’“”]/g, "'").trim();

  // Pipe-stack page titles: take the longest meaningful segment that
  // doesn't itself look like a junk header. ("Renovation Builders
  // Sydney|Civil Construction Companies Sydney|Remedial Building Sydney"
  // → "Renovation Builders Sydney")
  if (work.includes('|')) {
    const segments = work.split('|').map(s => s.trim()).filter(Boolean);
    if (segments.length > 0) {
      // Prefer the first segment unless it's clearly an SEO keyword stack;
      // first segment is usually the most canonical brand name.
      work = segments[0];
    }
  }

  // After splitting pipes, try to strip a brand-marketing suffix on
  // " - ", " : ", " · " or " I " (the " I " case is "ADCO I Builder of
  // Choice"). Only strip if the LEFT side looks like a real name.
  const sepMatch = work.match(SUFFIX_SEPARATORS);
  if (sepMatch && sepMatch.index !== undefined && sepMatch.index >= 2) {
    const left = work.slice(0, sepMatch.index).trim();
    // Keep the strip only when the left side has at least one letter
    // and isn't itself a junk header — otherwise we'd mangle names
    // like "Inc - 2024 Annual Report" into "Inc".
    if (/[A-Za-z]/.test(left) && left.length >= 2) {
      const cleanedLeft = left;
      // Still validate against junk patterns; don't strip into an
      // even-worse fragment.
      const looksJunkyAfter = JUNK_NAME_PATTERNS.some(p => p.test(cleanedLeft));
      if (!looksJunkyAfter) {
        work = cleanedLeft;
      }
    }
  }

  // Drop trailing parenthetical taglines that don't carry the brand
  // ("Lipman (Builder of the Year 2024)" → "Lipman"). Conservative:
  // only when the parenthetical is at the END.
  work = work.replace(/\s*\([^)]*\)\s*$/, '').trim();

  // Final check — does the result still look like junk?
  const stillJunk = JUNK_NAME_PATTERNS.some(p => p.test(work)) || work.length < 2;

  return {
    cleaned: work || null,
    was_clean: work === original,
    original,
    still_junk: stillJunk,
  };
}

/**
 * Predicate convenience — true when this name is still junk after
 * normalisation. Render uses this to refuse rather than send "Hi X at
 * Company History — ..." or trigger the LLM to invent a clean name.
 */
export function looksLikeJunkCompanyName(name: string | null | undefined): boolean {
  return cleanCompanyName(name).still_junk;
}

/**
 * Derive a company name from a domain root. "goldenlogistics.com.au" →
 * "Golden Logistics". Splits at known business-suffix words when the
 * domain root is a single merged token, otherwise just title-cases the
 * root. Strips common TLDs and the leading www.
 *
 * Not perfect — domains without a recognised suffix word stay merged
 * (e.g. "vaughans" → "Vaughans"). The output is always better than an
 * article-title-shaped partner_name, even if occasionally clumsy.
 */
const BUSINESS_SUFFIX_WORDS = [
  'logistics', 'transport', 'transports', 'construction', 'contracting',
  'services', 'service', 'group', 'partners', 'capital', 'industries',
  'industrial', 'solutions', 'systems', 'consulting', 'software', 'tech',
  'media', 'health', 'energy', 'finance', 'financial', 'legal', 'medical',
  'property', 'properties', 'realty', 'estate', 'investments', 'global',
  'international', 'australia', 'australian', 'holdings', 'enterprises',
  'corp', 'corporation', 'inc', 'pty', 'ltd', 'limited', 'co',
];

export function companyNameFromDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  let work = domain.toString().trim().toLowerCase();
  work = work.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  work = work.replace(/\.(com\.au|com|net|net\.au|org|org\.au|io|co|co\.uk|co\.nz|uk|us|de|fr|nz|au)$/i, '');
  if (!work) return null;

  let parts: string[];
  if (/[-_.]/.test(work)) {
    parts = work.split(/[-_.]+/).filter(Boolean);
  } else {
    let split = work;
    for (const suffix of BUSINESS_SUFFIX_WORDS) {
      if (split.length > suffix.length && split.endsWith(suffix)) {
        split = split.slice(0, -suffix.length) + ' ' + suffix;
        break;
      }
    }
    parts = split.split(/\s+/).filter(Boolean);
  }

  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/**
 * Pick the canonical company_name when we have both a scraped name and
 * a domain. Used by the discover pipeline to stop article titles being
 * persisted as partner_name when the actual company is identifiable
 * from the domain (which Hunter just contacted).
 *
 * Algorithm:
 *   1. Clean the scraped name. If junk-shaped, use domain-derived.
 *   2. Tokenise the cleaned scraped name (lowercase words ≥3 chars).
 *   3. If ANY token appears as a substring of the domain root, the
 *      scraped name and domain refer to the same company — keep
 *      the cleaned scraped name (richer than autoformat).
 *   4. Otherwise the scraped name was an article title that happens
 *      to live on the company's domain — prefer the domain-derived
 *      name so the rendered email addresses the right firm.
 *
 * Operator flagged 2026-05-19: drafts addressed to "Renovation
 * Builders Sydney" landed in Mina's inbox at everestcontracting.com.au
 * — same domain, different brand identity. Recipient sees a foreign
 * firm name on their own page and reads as poorly-targeted.
 */
export function selectCanonicalCompanyName(scrapedName: string | null | undefined, domain: string | null | undefined): {
  canonical: string | null;
  source: 'scraped' | 'domain' | 'none';
} {
  const fromDomain = companyNameFromDomain(domain);
  const cleaned = cleanCompanyName(scrapedName);

  if (cleaned.still_junk || !cleaned.cleaned) {
    return fromDomain
      ? { canonical: fromDomain, source: 'domain' }
      : { canonical: cleaned.cleaned, source: cleaned.cleaned ? 'scraped' : 'none' };
  }

  const domainRoot = (domain || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/\.(com\.au|com|net|net\.au|org|org\.au|io|co|co\.uk|co\.nz|uk|us|de|fr|nz|au)$/i, '')
    .replace(/[-_.]/g, '');

  if (!domainRoot) return { canonical: cleaned.cleaned, source: 'scraped' };

  const tokens = cleaned.cleaned
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);

  const hasOverlap = tokens.some(t => domainRoot.includes(t));
  if (hasOverlap) return { canonical: cleaned.cleaned, source: 'scraped' };

  return fromDomain
    ? { canonical: fromDomain, source: 'domain' }
    : { canonical: cleaned.cleaned, source: 'scraped' };
}
