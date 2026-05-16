/**
 * Discovery query generator.
 *
 * Reads a product's ICP fields + Knowledge Base sources and asks Claude to
 * write N specific lender search queries tuned to that facility. Used by the
 * batch discover route to turn "click one button" into "10 parallel searches".
 *
 * One Claude call per product per batch — not per-candidate. Cheap.
 *
 * The queries are designed for LinkedIn people search AND Brave web search;
 * good queries work on both. The renderer's hard requirement of a specific
 * credit signal means we bias toward queries that surface people with named
 * deal history, not generic "private credit" lists.
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { meterTokens } from '@/lib/usage/events';
import type { MeterFor } from '@/lib/agent/brave-tools';

export interface ProductForQueryGen {
  name: string;
  one_sentence_description: string | null;
  core_mechanism: string | null;
  customer_outcomes: string | null;
  icp_company_size: string | null;
  icp_verticals: string | null;
  icp_buyer_title: string | null;
  icp_stage: string | null;
  exclusions: string | null;
  // Project-specific (optional — present when generator is called for a project)
  sponsor?: string | null;
  project_type?: string | null;
  funding_target?: string | null;
  geography?: string | null;
  asset_class?: string | null;
  description?: string | null;
}

export interface KnowledgeBaseSource {
  title: string;
  source_type: string;
  url: string | null;
  content: string | null; // PDF extract or pasted text
}

export interface GeneratedQuery {
  query: string;
  rationale: string;
  expected_category: string;
}

export interface QueryGenerationResult {
  ok: true;
  // LinkedIn / Sales Navigator: person-targeting queries (roles, titles,
  // geographies). LinkedIn indexes profiles, so we search for "investment
  // director family office Melbourne" not "private credit fund deals 2024".
  linkedin_queries: GeneratedQuery[];
  // Brave web: deal/fund/news language. LinkedIn blocks Brave from indexing
  // profile pages, so person-targeting queries return ~0 on Brave. We instead
  // search for company-level signal: fund reports, press releases, news of
  // recent deals.
  brave_queries: GeneratedQuery[];
  product_summary: string;
}

export interface QueryGenerationError {
  ok: false;
  error: string;
}

const SYSTEM_PROMPT = `You generate prospect search queries for InvestorPilot — a platform for sourcing capital for real-estate / construction projects. Cast a WIDE NET. A simple search like "real estate investments property development funding" on Bing/Google returns thousands of relevant results. Your queries should pull at least that many candidates for human review, not zero. Err toward breadth, not precision.

Target roles to surface (in priority order):
1. Family-office principals + directors with real-estate or construction backgrounds
2. Real-estate fund managers / fund-of-funds principals
3. Real-estate private-equity partners
4. Construction-finance specialists (banks + private credit)
5. HNW direct-lenders / private-debt allocators
6. Property-credit fund principals
7. Real-asset investment officers at institutional allocators

You must generate TWO separate query sets, tuned to two different search engines:

LINKEDIN / SALES NAVIGATOR — searches PROFILES with AND-matching across keywords (EVERY word must appear in the profile or it's filtered out). KEEP LINKEDIN QUERIES TIGHT: 3-4 words max. Each extra word shrinks the result pool exponentially. Use ONE role term + ONE geography. Best examples (broad, return hundreds of hits):

✅ GOOD (3-4 words, broad LinkedIn role + geo):
- "real estate investor"
- "real estate fund"
- "family office real estate"
- "real estate private equity"
- "property development fund"
- "real estate debt"
- "construction finance Singapore"
- "private credit Hong Kong"
- "real estate fund manager"
- "property credit fund"
- "family office Singapore"
- "real estate investment director"
- "real estate partner London"
- "construction lender Dubai"
- "real estate director New York"

❌ BAD (6+ words, returns 0 because AND-match requires every word):
- "head of private credit Sydney residential construction debt"
- "family office Melbourne direct lending modular housing finance"
- "Singapore family office CIO Australian property credit allocator"

LinkedIn rule of thumb: ONE asset-class word + ONE role/seniority word + ONE geo = max 3-4 words. "Real estate investor" or "real estate fund" alone surfaces tens of thousands of profiles. That's GOOD — let the scoring layer triage; don't pre-filter via narrow queries.

BRAVE WEB SEARCH — searches the public web. LinkedIn blocks Brave from indexing profile pages, so person-targeting queries return ~0. Brave is great for finding COMPANIES via:
- Fund reports / fund websites
- News mentions of deal participation
- Press releases / industry publications
- Company websites + about pages
- Investor aggregator sites + databases

Good examples (3-6 words, broad enough to return many results):
- "real estate private credit fund"
- "family office real estate investment"
- "property development fund manager"
- "real estate debt fund"
- "construction finance fund"
- "single family office real estate"
- "real estate investment firm Singapore"
- "private credit fund Hong Kong real estate"
- "family office direct lending Australia"
- "real estate investment manager Asia Pacific"

Brave rule of thumb: 3-6 words, NO date qualifiers ("2024 OR 2025"), NO long noun chains. Let Brave's relevance ranking handle freshness. If you'd type it casually into Google, it's a good Brave query.

BAD queries (do not generate):
- Single-word queries: "investor", "fund" (too vague — return millions of irrelevant)
- 8+ word queries with multiple AND-clauses (return ~0)
- "tokenisation", "crypto", "RWA", "guarantee", "risk-free" (forbidden per v3)

If the product is SENIOR DEBT (most common): bias toward "real estate debt fund", "private credit", "construction finance", "family office direct lending".
If the product is PROJECT EQUITY: bias toward "real estate fund manager", "real estate private equity", "family office real estate", "limited partner real estate".

⚠ GEOGRAPHIC RULE — INTERNATIONAL PRIMARY, AU SECONDARY (IMPORTANT):

The F2K fund model requires capital that can hold offshore-funded modular construction-manufacturing positions. Australian lenders are too locked into the AU-domestic property-credit paradigm to underwrite this structure — they typically can't or won't take the cross-border manufacturing-finance leg.

PRIMARY TARGETS (rank these highest):
- Singapore — private credit, construction finance, family office direct lending
- Hong Kong — same categories, especially construction-specialist funds
- USA — NYC / Miami / SF / Houston: construction finance, real estate debt, offshore allocators
- UK / London — construction finance, real estate credit
- UAE / Dubai — construction-finance specialists with EM/offshore mandates

SECONDARY (still include, but rank lower):
- Sydney, Melbourne — AU family offices and private credit (cap at 1-2 queries)

GENERATION RULE (NON-NEGOTIABLE):
- Generate AT LEAST 3 international-targeting LinkedIn queries before any AU-targeting query.
- Prefer "construction finance [geography]" or "construction lender [geography]" formulations — these surface the construction-specialist lenders who actually have the mandate to do cross-border modular deals.
- The project asset's physical location (Tasmania, WA, etc.) NEVER dictates the lender geography. Capital comes from offshore; we're sourcing lenders, not occupants.
- For Brave queries, lean into "cross-border construction finance", "offshore real estate debt", "modular construction lender deal" — surface fund reports, news of deals, fund websites with offshore allocations.

Return ONLY a JSON object, no markdown or prose:
{
  "product_summary": "<2-3 sentence summary of what you understood the product to be>",
  "linkedin_queries": [
    {
      "query": "<person-targeting search string, 3-5 WORDS MAX — AND-matched on LinkedIn>",
      "rationale": "<one sentence on why this surfaces the right people>",
      "expected_category": "<who this targets, e.g. 'Sydney family office principal'>"
    },
    ...N_LINKEDIN total
  ],
  "brave_queries": [
    {
      "query": "<company/deal/news search string, 4-10 words>",
      "rationale": "<one sentence on why this surfaces relevant company-level signal>",
      "expected_category": "<what this targets, e.g. 'Recent AU private debt deals'>"
    },
    ...N_BRAVE total
  ]
}`;

export async function generateLenderQueries(input: {
  product: ProductForQueryGen;
  knowledgeBase: KnowledgeBaseSource[];
  // Total queries split across LinkedIn (50%) + Brave (50%). Default 6 = 3 LI + 3 Brave.
  // Bumped Brave's share from 40% → 50% on 2026-05-15 — operators noted that a
  // simple "real estate fund" Google search returns thousands of results,
  // while our prior 1-2 Brave queries per run returned zero. More Brave
  // queries × broader prompt = actual breadth.
  count?: number;
  meterFor?: MeterFor;
}): Promise<QueryGenerationResult | QueryGenerationError> {
  const total = Math.min(Math.max(input.count || 6, 4), 15);
  const linkedinCount = Math.max(1, Math.floor(total * 0.5));
  const braveCount = Math.max(1, total - linkedinCount);

  // Build a compact product context string. Keep knowledge base extracts
  // capped so we stay under the model's context budget without summarising.
  const kbBlocks = input.knowledgeBase
    .filter(s => s.content && s.content.trim())
    .map(s => `[${s.source_type.toUpperCase()}: ${s.title}]\n${s.content!.slice(0, 4000)}`)
    .join('\n\n---\n\n');

  const projectBlock = input.product.sponsor || input.product.funding_target || input.product.geography || input.product.asset_class
    ? `\nPROJECT-SPECIFIC:\nSponsor: ${input.product.sponsor || '(none)'}\nProject type: ${input.product.project_type || '(none)'}\nFunding target: ${input.product.funding_target || '(none)'}\nGeography: ${input.product.geography || '(none)'}\nAsset class: ${input.product.asset_class || '(none)'}\n`
    : '';

  const userMessage = `Generate ${linkedinCount} LinkedIn-tuned + ${braveCount} Brave-tuned queries for this offering.

OFFERING:
Name: ${input.product.name}
Description: ${input.product.description || input.product.one_sentence_description || '(none)'}
Core mechanism: ${input.product.core_mechanism || '(none)'}
Buyer/lender outcomes: ${input.product.customer_outcomes || '(none)'}
ICP buyer title: ${input.product.icp_buyer_title || '(none)'}
ICP company size: ${input.product.icp_company_size || '(none)'}
ICP verticals: ${input.product.icp_verticals || '(none)'}
ICP stage: ${input.product.icp_stage || '(none)'}
Exclusions: ${input.product.exclusions || '(none)'}${projectBlock}
${kbBlocks ? `KNOWLEDGE BASE (verbatim excerpts):\n\n${kbBlocks}\n\n` : 'KNOWLEDGE BASE: (empty — generate from offering fields alone)\n\n'}Return exactly ${linkedinCount} linkedin_queries (person-targeting) and ${braveCount} brave_queries (company/deal/news) as JSON per the schema.

If PROJECT-SPECIFIC details are present, weave geography + asset class + funding type into both query sets so they surface the right specific slice of lenders (e.g. for "Tasmania modular construction senior debt" the queries should mention Tasmania, modular construction, residential dev debt, etc).`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    meterTokens(input.meterFor, response, MODEL);

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: 'LLM returned no JSON object' };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const liQueries = pickQueryArray(parsed.linkedin_queries).slice(0, linkedinCount);
    const braveQueries = pickQueryArray(parsed.brave_queries).slice(0, braveCount);

    if (liQueries.length === 0 && braveQueries.length === 0) {
      return { ok: false, error: 'LLM returned no usable queries' };
    }

    return {
      ok: true,
      linkedin_queries: liQueries,
      brave_queries: braveQueries,
      product_summary: typeof parsed.product_summary === 'string' ? parsed.product_summary : '',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function pickQueryArray(raw: unknown): GeneratedQuery[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (q: unknown): q is GeneratedQuery =>
      typeof q === 'object' && q !== null &&
      typeof (q as { query?: unknown }).query === 'string' &&
      (q as { query: string }).query.trim().length > 0
  );
}
