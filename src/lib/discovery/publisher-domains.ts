/**
 * Publisher / journalism / academic domain detection.
 *
 * Brave web search returns ARTICLES about companies, not the companies
 * themselves. If we then call Hunter.io on the article URL's hostname,
 * we get the publisher's staff (journalists, editors, reporters) instead
 * of anyone at the company the article is about. The scorer rates the
 * row high because the article TOPIC matches the ICP — but the contact
 * is wrong.
 *
 * Surfaced 2026-05-18: Discover for "lender" returned Devin Nadi
 * (Business Insider reporter), Eloise Keating (SmartCompany journalist),
 * Lisa Kahn (Yale SOM staff) — all scoring 8.4–8.95 because the articles
 * they wrote were about funded vertical-SaaS startups. None match the
 * product's buyer profile (CTO / Head of Product / Founder/CEO).
 *
 * This module is the first defence: reject Brave results whose hostname
 * is a known publisher / academic / aggregator BEFORE we ever call
 * Hunter. Cheap, deterministic, zero LLM cost. Pairs with
 * src/lib/pipeline/scoring-prompt.ts hard-gating buyer_title in the
 * scorer prompt and a post-Hunter title regex in discover-batch/route.ts.
 */

// Major publisher / news / aggregator / academic / government domains.
// Keep the list manually curated — programmatic detection (e.g. "looks
// like a news site") tends to over-reject company blogs and corporate
// newsrooms that ARE valid prospect surfaces.
const PUBLISHER_HOSTNAMES = new Set<string>([
  // Major global business / tech press
  'businessinsider.com',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'bloomberg.com',
  'reuters.com',
  'wsj.com',
  'ft.com',
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  'axios.com',
  'theinformation.com',
  'forbes.com',
  'fortune.com',
  'fastcompany.com',
  'inc.com',
  'cnbc.com',
  'cnn.com',
  'bbc.com',
  'bbc.co.uk',
  'economist.com',
  'theatlantic.com',
  'newyorker.com',
  'foreignpolicy.com',
  'protocol.com',
  'engadget.com',
  'theregister.com',
  'arstechnica.com',
  'venturebeat.com',
  'gizmodo.com',
  'theinformation.com',
  'thenextweb.com',
  'mashable.com',
  'zdnet.com',
  'cnet.com',
  // AU / NZ
  'smartcompany.com.au',
  'afr.com',
  'theaustralian.com.au',
  'smh.com.au',
  'theage.com.au',
  'news.com.au',
  'abc.net.au',
  'sbs.com.au',
  'crikey.com.au',
  'startupdaily.net',
  'businessdesk.co.nz',
  'nzherald.co.nz',
  // Tech / startup
  'producthunt.com',
  'crunchbase.com',
  'pitchbook.com',
  'angellist.com',
  'wellfound.com',
  // Aggregators / blog hosts (people commonly post articles HERE, not
  // run companies HERE)
  'medium.com',
  'substack.com',
  'hashnode.com',
  'dev.to',
  'news.ycombinator.com',
  'reddit.com',
  // EdTech / industry trade press
  'edtechreview.in',
  'edsurge.com',
  'edtechmagazine.com',
  'constructiondive.com',
  'engineeringnews.co.za',
  'tech.eu',
  'eu-startups.com',
  'sifted.eu',
  'tech.co',
  'thetechpanda.com',
  'tnw.eu',
  'thenextweb.com',
  'businessoffashion.com',
  // Pitch deck / fundraising-advice consultancies that publish content
  // about other companies' raises — Hunter on their domain returns
  // consultancy staff, not the actual companies being covered.
  'waveup.com',
  'slidebean.com',
  'pitch.com',
  'visible.vc',
  // Social platforms / professional networks — Brave occasionally returns
  // these as top results (e.g. company profile page hosted on LinkedIn,
  // a Facebook business page). The hostname belongs to the platform, not
  // the target prospect. Hunter on linkedin.com returns LinkedIn employees,
  // not the company whose profile got matched. Burned by this 2026-05-21
  // when 'Daniel Maurath @ Linkedin (dmaurath@linkedin.com)' surfaced as
  // a construction-company prospect.
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'glassdoor.com',
  'indeed.com',
  'yelp.com',
]);

// Pattern-based catch for the long tail. These match a hostname's
// "interior" — i.e. words that strongly signal "this is a publisher,
// not a company we'd sell to". Tuned to avoid false positives on
// genuine company domains (e.g. don't match on the bare word "tech"
// or "ai" which are common in SaaS company names).
const PUBLISHER_PATTERNS: RegExp[] = [
  /\bnews\b/i,
  /\bpress\b/i,
  /\bmagazine\b/i,
  /\bjournal\b/i,
  /\btribune\b/i,
  /\bherald\b/i,
  /\bgazette\b/i,
  /\bdaily\b/i,
  /\bweekly\b/i,
  /\bchronicle\b/i,
  /\breporter\b/i,
  /\bpublication\b/i,
  /\bwire\b/i,
  /\btimes\.(com|co\.uk|co\.au|net)$/i,  // *.times.com — broad but the FT-style use is real
];

// Academic / government TLDs and SLDs. Universities + government
// agencies are sometimes interesting prospects (research budgets,
// procurement) but the contact-extraction problem is the same: the
// person whose byline lands on the article is a researcher or PR
// staffer, not a buyer.
const ACADEMIC_GOV_SUFFIXES: RegExp[] = [
  /\.edu$/i,
  /\.edu\.[a-z]{2,3}$/i,         // .edu.au, .edu.uk, etc.
  /\.ac\.[a-z]{2,3}$/i,          // .ac.uk, .ac.nz, etc.
  /\.gov$/i,
  /\.gov\.[a-z]{2,3}$/i,
  /\.govt\.[a-z]{2,3}$/i,
  /\.mil$/i,
  /\.int$/i,
];

/**
 * Returns true if the hostname looks like a publisher, academic, or
 * government site — i.e. somewhere whose staff are NOT plausible
 * prospects for a typical B2B product. Used at Brave-result ingest
 * time to short-circuit the contact-extraction pipeline for these
 * domains.
 *
 * Strips leading "www." automatically.
 */
export function isPublisherDomain(hostname: string): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase().replace(/^www\./, '').trim();
  if (PUBLISHER_HOSTNAMES.has(host)) return true;
  for (const re of ACADEMIC_GOV_SUFFIXES) if (re.test(host)) return true;
  for (const re of PUBLISHER_PATTERNS) if (re.test(host)) return true;
  return false;
}

// Note: title-based filtering is INTENTIONALLY not in this file.
// Career-based rejection (journalists / academics / etc.) belongs in
// the operator's product profile via buyer_title + exclusions, applied
// by the LLM scorer's hard-gate. Hardcoding it here would override
// operator intent and require code changes every time a new profession
// needed filtering. Domain-based filtering above IS appropriate
// because it operates one layer earlier — it's about whether a URL's
// hostname represents the CANDIDATE company at all (publisher domains
// return their own staff via Hunter, not anyone at the company the
// article is ABOUT) — a correctness issue, not a taste judgement.
