/**
 * Page-content fetcher with JS rendering + quality validation.
 *
 * The naive fetch+strip approach used previously returned mostly-empty
 * shells for JS-rendered SPAs (React/Vue/Next.js sites). Claude then
 * hallucinated descriptions to fill the gap, producing wildly wrong ICP
 * fields (e.g. LingoPure's product description became "discovery tool
 * that identifies buyers, investors, lenders…" — InvestorPilot's own
 * description, leaked through context).
 *
 * Resolution: route through Firecrawl when FIRECRAWL_API_KEY is set.
 * Firecrawl runs a headless browser, returns clean markdown, and handles
 * cookie consent / Cloudflare / lazy-loading. Falls back to the naive
 * path when the key is missing so dev environments still work.
 *
 * Also adds a quality check at the end: too-short content OR content
 * that doesn't contain enough useful tokens returns a structured failure
 * so callers can surface a clear error instead of feeding garbage to
 * the LLM.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';
const NAIVE_FETCH_TIMEOUT_MS = 10_000;
const FIRECRAWL_TIMEOUT_MS = 30_000;
const MIN_USEFUL_CHARS = 300;
const MAX_CHARS = 10_000;

export interface FetchPageOk {
  ok: true;
  content: string;
  source: 'firecrawl' | 'naive';
  url: string;
  /** Approximate quality signal — true when content is reasonably long and looks like real prose. */
  highQuality: boolean;
}

export interface FetchPageError {
  ok: false;
  error: string;
  url: string;
  /** Hint the UI surfaces — usually "paste the text directly" when scrape failed. */
  suggested_action: 'paste_text_directly' | 'try_different_url' | 'check_url_accessibility';
}

export type FetchPageResult = FetchPageOk | FetchPageError;

/**
 * Fetch and clean a page. Prefers Firecrawl (rendered) when configured.
 * Returns a discriminated union — never throws, never returns hallucinatable
 * placeholders like "[Failed to fetch]".
 */
export async function fetchPageContent(url: string): Promise<FetchPageResult> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      error: 'URL must start with http:// or https://',
      url,
      suggested_action: 'try_different_url',
    };
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    const result = await fetchViaFirecrawl(url, firecrawlKey);
    if (result.ok) return result;
    // Firecrawl failed — try the naive path before giving up. Some sites
    // serve perfectly usable HTML server-side and don't need JS rendering;
    // Firecrawl can fail on those if they block its IPs.
    console.warn('[fetch-page] firecrawl failed for', url, '—', result.error, '→ falling back to naive fetch');
  }

  return fetchViaNaiveFetch(url);
}

async function fetchViaFirecrawl(url: string, apiKey: string): Promise<FetchPageResult> {
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v2/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        // Wait for SPA frameworks to render. 1500ms covers most React/Vue
        // landing pages without dragging total wall time too high.
        waitFor: 1500,
        onlyMainContent: true,
        timeout: 25_000,
      }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `Firecrawl ${res.status}: ${text.slice(0, 200)}`,
        url,
        suggested_action: 'check_url_accessibility',
      };
    }

    const json = (await res.json()) as { success?: boolean; data?: { markdown?: string }; error?: string };
    if (!json.success || !json.data?.markdown) {
      return {
        ok: false,
        error: json.error || 'Firecrawl returned no content',
        url,
        suggested_action: 'paste_text_directly',
      };
    }

    return assessQuality(json.data.markdown, 'firecrawl', url);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      url,
      suggested_action: 'check_url_accessibility',
    };
  }
}

async function fetchViaNaiveFetch(url: string): Promise<FetchPageResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InvestorPilot/1.0 (product-profile-extractor)' },
      signal: AbortSignal.timeout(NAIVE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Server returned ${res.status} for ${url}`,
        url,
        suggested_action: 'check_url_accessibility',
      };
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return assessQuality(text, 'naive', url);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      url,
      suggested_action: 'check_url_accessibility',
    };
  }
}

/**
 * Heuristic quality check. Catches the JS-rendered-shell failure mode
 * (where the response is technically successful but contains only
 * boilerplate like "You need to enable JavaScript" or a Next.js
 * placeholder).
 */
function assessQuality(raw: string, source: 'firecrawl' | 'naive', url: string): FetchPageResult {
  const content = raw.slice(0, MAX_CHARS);
  const stripped = content.trim();

  if (stripped.length < MIN_USEFUL_CHARS) {
    return {
      ok: false,
      error: `Page content is too short (${stripped.length} chars) — site likely renders content via JavaScript that the scraper couldn't see.`,
      url,
      suggested_action: 'paste_text_directly',
    };
  }

  // Common shells from JS-only sites
  const shellMarkers = [
    /You need to enable JavaScript to run this app/i,
    /This site requires JavaScript/i,
    /Please enable JavaScript and reload/i,
    /Loading\s*\.\.\./i,
  ];
  if (shellMarkers.some((m) => m.test(stripped) && stripped.length < 1500)) {
    return {
      ok: false,
      error: 'Page only returned a JavaScript shell — content didn\'t render server-side.',
      url,
      suggested_action: 'paste_text_directly',
    };
  }

  // Naive fetch returning lots of script-injected JSON noise vs prose
  const wordsCount = stripped.split(/\s+/).filter((w) => /[a-z]{3,}/i.test(w)).length;
  const highQuality = wordsCount >= 200 && stripped.length >= 800;

  return { ok: true, content: stripped, source, url, highQuality };
}
