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
}

export interface KnowledgeBaseSource {
  title: string;
  source_type: string;
  url: string | null;
  content: string | null; // PDF extract or pasted text
}

export interface GeneratedQuery {
  query: string;          // Free-text search string usable in LinkedIn + Brave
  rationale: string;      // One-line why this query surfaces a relevant slice
  expected_category: string; // Which lender bucket this query targets, e.g. "Sydney family office"
}

export interface QueryGenerationResult {
  ok: true;
  queries: GeneratedQuery[];
  product_summary: string; // Claude's interpretation of what the product is — for debugging
}

export interface QueryGenerationError {
  ok: false;
  error: string;
}

const SYSTEM_PROMPT = `You generate lender search queries for InvestorPilot — a multi-channel outreach platform for placing senior debt and equity into real-asset investment vehicles.

Given a product (what is being funded) and any uploaded knowledge base context (investment memoranda, term sheets, project overviews), generate N specific search queries that would surface the RIGHT KIND of capital provider to fund it.

Queries must be USABLE on both LinkedIn people search and Brave web search. Examples of good queries:
- "family office Sydney private debt Australian property"
- "private credit fund $5M tickets Australian real estate development"
- "HNW direct lender modular construction Tasmania"
- "Singapore family office Australian property credit allocator"
- "Melbourne wholesale property credit principal"

Examples of BAD queries (too vague, will surface noise):
- "investor"
- "Australian finance"
- "real estate funding"

Guidelines:
- Each query targets a SPECIFIC slice of the capital market (a geography + role + asset class signal)
- Vary geography, role/seniority, sub-asset-class, and explicit cheque-size language across queries
- If the product is senior debt: bias toward "private credit fund", "direct lender", "family office private debt"
- If the product is project equity: bias toward "limited partner", "co-investment", "real asset private capital"
- AVOID queries that would surface retail banks, mortgage brokers, equity-only family offices (the v3 lender ICP rejects these — generating queries that surface them wastes the scoring budget)
- AVOID queries that mention forbidden phrases ("guarantee", "risk-free", "tokenisation") — even at the discovery layer

Return ONLY a JSON object, no markdown or prose:
{
  "product_summary": "<2-3 sentence summary of what you understood the product to be>",
  "queries": [
    {
      "query": "<search string, 4-10 words>",
      "rationale": "<one sentence on why this surfaces relevant capital>",
      "expected_category": "<lender bucket, e.g. 'Sydney family office' | 'Melbourne private credit fund' | 'Singapore HNW principal'>"
    },
    ...
  ]
}`;

export async function generateLenderQueries(input: {
  product: ProductForQueryGen;
  knowledgeBase: KnowledgeBaseSource[];
  count?: number; // default 8
}): Promise<QueryGenerationResult | QueryGenerationError> {
  const count = Math.min(Math.max(input.count || 8, 3), 15);

  // Build a compact product context string. Keep knowledge base extracts
  // capped so we stay under the model's context budget without summarising.
  const kbBlocks = input.knowledgeBase
    .filter(s => s.content && s.content.trim())
    .map(s => `[${s.source_type.toUpperCase()}: ${s.title}]\n${s.content!.slice(0, 4000)}`)
    .join('\n\n---\n\n');

  const userMessage = `Generate ${count} lender search queries for this product.

PRODUCT:
Name: ${input.product.name}
Description: ${input.product.one_sentence_description || '(none)'}
Core mechanism: ${input.product.core_mechanism || '(none)'}
Customer/lender outcomes: ${input.product.customer_outcomes || '(none)'}
ICP buyer title: ${input.product.icp_buyer_title || '(none)'}
ICP company size: ${input.product.icp_company_size || '(none)'}
ICP verticals: ${input.product.icp_verticals || '(none)'}
ICP stage: ${input.product.icp_stage || '(none)'}
Exclusions: ${input.product.exclusions || '(none)'}

${kbBlocks ? `KNOWLEDGE BASE (verbatim excerpts):\n\n${kbBlocks}\n\n` : 'KNOWLEDGE BASE: (empty — generate from product fields alone)\n\n'}Return exactly ${count} queries as JSON per the schema.`;

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
    const queries: GeneratedQuery[] = Array.isArray(parsed.queries)
      ? parsed.queries
          .filter((q: unknown): q is { query: string; rationale: string; expected_category: string } =>
            typeof q === 'object' && q !== null && typeof (q as { query?: unknown }).query === 'string' && (q as { query: string }).query.trim().length > 0
          )
          .slice(0, count)
      : [];

    if (queries.length === 0) {
      return { ok: false, error: 'LLM returned no usable queries' };
    }

    return {
      ok: true,
      queries,
      product_summary: typeof parsed.product_summary === 'string' ? parsed.product_summary : '',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
