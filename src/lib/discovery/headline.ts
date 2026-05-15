/**
 * Shared helper for extracting a firm name from a LinkedIn-style headline.
 *
 * Used by discover-batch (to populate company_name at discovery time) and
 * the enrichment orchestrator (to backfill company_name when Unipile's
 * profile fetch returns a richer headline than the search response did).
 *
 * Returns null when the pattern doesn't match, so callers can fall through
 * to a different source (person.full_name, manual entry, etc.).
 *
 * Common LinkedIn headline patterns:
 *   "Managing Director at Versobuild Pte Ltd"               → "Versobuild Pte Ltd"
 *   "Senior Infrastructure Finance Specialist - World Bank" → "World Bank"
 *   "CIO @ Capital Group"                                    → "Capital Group"
 *   "Investment Director | Pacific Vista"                    → "Pacific Vista"
 *
 * Conservative — only matches the four delimiters with surrounding
 * whitespace. Random punctuation (commas, etc.) returns null rather than
 * mis-splitting on dots/quotes.
 */
export function extractCompanyFromHeadline(headline: string | null | undefined): string | null {
  if (!headline) return null;
  const match = headline.match(/(?:\s+at\s+|\s+@\s+|\s+-\s+|\s+\|\s+)(.+)$/i);
  if (!match) return null;
  const candidate = match[1].trim();
  // Reject obvious non-companies — too short, too long. Heuristic.
  if (candidate.length < 2 || candidate.length > 120) return null;
  // Strip trailing role suffixes after "/" or "," that some users append.
  return candidate.replace(/\s*[/,].*$/, '').trim() || null;
}
