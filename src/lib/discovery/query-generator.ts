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

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY!,
  ...(process.env.OPENROUTER_API_KEY
    ? {
        baseURL: 'https://openrouter.ai/api',
        defaultHeaders: {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://investorpilot.vercel.app',
          'X-Title': 'InvestorPilot',
        },
      }
    : {}),
});

const MODEL = process.env.OPENROUTER_API_KEY
  ? process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4-20250514'
  : process.env.AGENT_MODEL || 'claude-sonnet-4-20250514';

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

const SYSTEM_PROMPT = `You generate lender search queries for InvestorPilot — a multi-channel outreach platform for placing senior debt and equity into real-asset investment vehicles.

You must generate TWO separate query sets, tuned to two different search engines:

LINKEDIN / SALES NAVIGATOR — searches PROFILES of individuals. Best for finding the right person to talk to (FO principal, CIO, head of private credit). Use:
- Person/role/title language: "family office principal", "head of private credit", "investment director"
- Geography: "Sydney", "Melbourne", "Singapore", "Brisbane", "Hong Kong"
- Sub-asset-class hint: "private debt", "direct lending", "real estate credit"
- Cheque-size language: "$5M tickets", "wholesale"
Good examples:
- "family office principal Sydney private debt Australian property"
- "head of private credit Melbourne investment director"
- "Singapore family office CIO Australian property credit allocator"
- "Investment director SMSF wholesale property debt Australia"

BRAVE WEB SEARCH — searches the public web. LinkedIn blocks Brave from indexing profile pages, so person-targeting queries return ~0. Brave is great for finding COMPANIES via:
- Fund reports / fund websites
- News mentions of deal participation
- Press releases / industry publications
- Company websites
Good examples:
- "Australian property private credit fund 2024 OR 2025"
- "private debt allocator Australian residential development deal"
- "family office direct lending Australian property news"
- "wholesale property credit transaction Australia recent"
- "Australian residential development senior debt placement"

BAD queries (do not generate):
- "investor", "Australian finance", "real estate funding" (too vague)
- "tokenisation", "crypto", "RWA", "guarantee", "risk-free" (forbidden per v3)
- Queries surfacing retail banks, mortgage brokers, equity-only family offices, listed REITs (v3 ICP rejects these)

If the product is SENIOR DEBT (most common): bias toward "private credit fund", "direct lender", "family office private debt", "wholesale debt".
If the product is PROJECT EQUITY: bias toward "limited partner", "co-investment", "real asset private capital".

⚠ GEOGRAPHIC RULE — DO NOT OVER-NARROW TO PROJECT LOCATION:
Even when the project asset sits in a regional location (e.g. Tasmania, regional WA, Geraldton), the capital pool is in Sydney + Melbourne + Singapore + Hong Kong. Most AU family offices and private credit funds invest interstate as a matter of routine. Generating Perth-only queries for a Geraldton project, or Tasmania-only queries for a Hobart project, will hit empty result pools.

ALWAYS include AT LEAST ONE Sydney-targeting query and AT LEAST ONE Melbourne- or Singapore-targeting query in linkedin_queries, regardless of project geography. The project's geo can feature in 1 query as "lenders familiar with [region]" — never make geo the primary discriminator across all queries.

Return ONLY a JSON object, no markdown or prose:
{
  "product_summary": "<2-3 sentence summary of what you understood the product to be>",
  "linkedin_queries": [
    {
      "query": "<person-targeting search string, 4-10 words>",
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
  // Total queries split across LinkedIn (60%) + Brave (40%). Default 5 = 3 LI + 2 Brave.
  count?: number;
}): Promise<QueryGenerationResult | QueryGenerationError> {
  const total = Math.min(Math.max(input.count || 5, 3), 15);
  const linkedinCount = Math.max(1, Math.ceil(total * 0.6));
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
