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
  /**
   * Migration 027 — fine-grained funding scenario. Passed in as the SLUG
   * (e.g. 'series_a', 'construction_debt_senior'); caller is responsible
   * for resolving it to the human-readable describe string for the prompt.
   */
  funding_type?: string | null;
  /** Pre-resolved describe string for funding_type — drops directly into the prompt. */
  funding_type_describe?: string | null;
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

const SYSTEM_PROMPT = `You generate prospect search queries for an outreach pipeline. Every query you produce must be driven by the OFFERING's stated ICP — its buyer/investor titles, verticals, company size, stage, geography, and exclusions. There is NO default vertical, NO default geography, and NO default role to chase. You read the offering, decide the direction of outreach, and generate queries that match.

STEP 1 — DETECT DIRECTION

Inspect the offering. Two directions are possible:

A. SELLING / BUYER-HUNTING. The offering is a product or service being SOLD (has icp_buyer_title, customer_outcomes, core_mechanism, partner_types like "buyer" or "integration"). The prospects are BUSINESSES THAT WOULD BUY THE OFFERING and the PEOPLE INSIDE THOSE BUSINESSES who hold the budget. Queries surface OPERATORS (the buyer companies + their decision-makers), NOT competing vendors.

B. SEEKING / INVESTOR-HUNTING. The offering is a capital raise (has funding_type, funding_target, sponsor, asset_class — typical of a fund/project). The prospects are INVESTORS / LENDERS / ALLOCATORS who fund that asset class. Queries surface FUNDS, FUND PRINCIPALS, FAMILY OFFICES, ALLOCATORS, and the decision-makers inside them.

If both signal sets appear, prefer the one with more fields populated. If neither is populated, use whatever fields exist to infer, and state your inference in product_summary.

STEP 2 — QUERY SHAPE (LINKEDIN vs BRAVE — universal rules)

LINKEDIN / SALES NAVIGATOR — searches PROFILES with AND-matching. EVERY word must appear in the profile or the row is filtered out. KEEP LINKEDIN QUERIES TIGHT: 3-4 words MAX. Pattern: ONE role/title term + ONE geography (optionally ONE vertical term, but only if titles are too broad without it).

Good shape examples (these are PATTERNS, not literal queries — substitute the offering's actual titles/verticals/geos):
- "<role> <geography>" → "managing director Sydney"
- "<vertical> <role>" → "construction founder"
- "<role> <vertical>" → "operations director manufacturing"
- "<niche-role>" alone if it's already narrow → "fund principal"

If the ICP buyer title is a list ("Owner, MD, GM, Operations Director"), produce SEPARATE queries for each — do NOT OR-chain them, LinkedIn AND-matches.

❌ NEVER:
- 5+ word queries (each extra word shrinks results exponentially)
- Vendor / tech keywords when buyer-hunting ("AI", "automation", "software", "tools", "platform", "SaaS") — these surface TECHNOLOGY PROVIDERS, not the operators who'd buy from them
- "best", "top", "guide", "review", "comparison" — surface listicles, not real prospects

BRAVE WEB SEARCH — searches the public web. LinkedIn blocks Brave from indexing profile pages, so person-targeting queries return ~0 on Brave. Brave finds COMPANIES (and news/funds/deals about them).

Brave query strategy depends on direction:

BUYER-HUNTING (direction A): queries must surface REAL OPERATING COMPANIES in the ICP verticals + geography. Pattern: "<vertical> <company-type> <geography>" or "<vertical> business <geography>" or "<sub-vertical-noun> <geography>".

Good shape examples (PATTERNS — adapt to the offering):
- "modular construction company Sydney"
- "logistics company family-owned Brisbane"
- "manufacturing SME Melbourne"
- "construction contractor New South Wales"
- "field services business Australia"
- "industrial bakery Queensland"

Avoid: any keyword that surfaces vendors instead of operators. "AI for construction" returns AI vendors. "Construction company Sydney" returns construction companies.

INVESTOR-HUNTING (direction B): queries surface FUNDS, FUND REPORTS, FAMILY OFFICES, ALLOCATORS, PRESS COVERAGE OF DEALS. Pattern: "<fund-type> <asset-class> <geography>" or "<allocator-type> <geography>".

Good shape examples (PATTERNS — adapt to the offering's funding_type + asset_class + geography):
- "private credit fund Singapore"
- "real estate debt fund Hong Kong"
- "family office direct lending"
- "construction finance fund Dubai"
- "infrastructure debt allocator London"

UNIVERSAL BRAVE RULES:
- 3-6 words
- No date qualifiers ("2024", "2025")
- No long noun chains
- If you'd type it casually into Google, it's a good Brave query

STEP 3 — APPLY ICP FIELDS

- icp_buyer_title / target titles: drive LinkedIn role queries (one query per distinct title).
- icp_verticals: drive Brave queries (one per vertical, especially when buyer-hunting). Verticals + geography combination is the highest-yield Brave pattern.
- icp_company_size: shapes vocabulary — "SME", "family-owned", "owner-operated", "mid-market" surface different result types. Pick the word that maps to the size band.
- icp_stage: filters for stage-specific terms ("growth-stage", "established", "post-seed") when relevant.
- geography: PRIMARY input for any Brave query and most LinkedIn queries. If the offering specifies multiple geographies, distribute queries across them proportionally. If the offering says "global" or omits geography, use the strongest 2-3 markets the offering plausibly serves.
  - DIRECTION-A SPECIFIC: geography is where the BUYERS operate. Queries should target operators in those markets.
  - DIRECTION-B SPECIFIC: geography names the PROJECT's physical location, NOT necessarily where the investors live. Read funding_type + asset_class to infer which capital markets typically fund this asset class — e.g. modular-construction senior debt with an Australian physical asset often needs offshore capital (Singapore, Hong Kong, UAE, US) because domestic lenders don't typically underwrite cross-border manufacturing-finance. Distribute queries across the capital markets that plausibly fund this asset class, not just the project's location.
- exclusions: NEVER produce a query that targets an excluded segment. If exclusions list "in-house tech teams" or "agencies", don't generate queries that surface those.
- funding_type (project mode): the single most predictive filter. A "construction_debt_senior" project needs lenders, NOT VCs. "Seed equity" needs angels/early-stage VCs, NOT lenders.

STEP 4 — GEOGRAPHIC AND VERTICAL BALANCE

When the offering targets multiple geographies or verticals, distribute the query budget across them. Don't concentrate every query on one slice. Example: an offering targeting ["construction", "trades", "manufacturing", "logistics"] with budget 10 queries should produce roughly 2-3 per vertical, mixed across the offering's geographies.

OUTPUT FORMAT

Return ONLY a JSON object, no markdown or prose:
{
  "product_summary": "<2-3 sentence summary of what the offering is AND which direction (selling-to-buyers vs seeking-capital) you inferred, with one-line reason>",
  "linkedin_queries": [
    {
      "query": "<3-4 words, AND-matched on LinkedIn>",
      "rationale": "<one sentence on why this surfaces the right people>",
      "expected_category": "<who this targets, e.g. 'Construction MDs Sydney' or 'Singapore private-credit principals'>"
    },
    ...N_LINKEDIN total
  ],
  "brave_queries": [
    {
      "query": "<3-6 words, casual Google-style>",
      "rationale": "<one sentence on why this surfaces the right companies/funds/news>",
      "expected_category": "<what this targets, e.g. 'Owner-operated modular builders Sydney' or 'Real-estate debt funds Hong Kong'>"
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

  // FUNDING TYPE is the single most predictive ICP filter — put it at the
  // top of the project block and elevate it in the project_type slot, with
  // its describe string so the LLM knows what kind of investor matches
  // (e.g. "construction_debt_senior" → "wholesale lenders writing
  // first-mortgage tickets, NOT VCs or angels"). Without this the
  // generator was producing equity/seed-stage queries against debt-fund
  // projects (the VC noise problem in DR-7f3616).
  const fundingTypeLine = input.product.funding_type_describe
    ? `\nFunding type (TOP PRIORITY — only generate queries matching this investor profile): ${input.product.funding_type_describe}`
    : input.product.funding_type
      ? `\nFunding type: ${input.product.funding_type}`
      : '';

  const projectBlock = input.product.sponsor || input.product.funding_target || input.product.geography || input.product.asset_class || input.product.funding_type
    ? `\nPROJECT-SPECIFIC:${fundingTypeLine}\nSponsor: ${input.product.sponsor || '(none)'}\nFunding target: ${input.product.funding_target || '(none)'}\nGeography: ${input.product.geography || '(none)'}\nAsset class: ${input.product.asset_class || '(none)'}\n`
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
${kbBlocks ? `KNOWLEDGE BASE (verbatim excerpts):\n\n${kbBlocks}\n\n` : 'KNOWLEDGE BASE: (empty — generate from offering fields alone)\n\n'}Return exactly ${linkedinCount} linkedin_queries and ${braveCount} brave_queries as JSON per the schema.

Detect direction (SELLING/buyer-hunting vs SEEKING/investor-hunting) from the fields above before writing any query. State the direction + one-line reason in product_summary. Then generate queries shaped by the offering's actual buyer titles / verticals / size / stage / geography — do not import vocabulary from any other offering. If exclusions list a segment, never produce a query that targets it.`;

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
