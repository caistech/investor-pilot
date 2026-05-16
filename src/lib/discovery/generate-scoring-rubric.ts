/**
 * Generate the ICP scoring rubric + categories for a product.
 *
 * Replaces the F2K-specific hardcoded rubric (set by migration 018) for
 * non-F2K tenants. One Claude one-shot call that reads the product's
 * pitch + ICP fields + KB sources and writes:
 *   - scoring_rubric (multi-line text describing how to score the 5
 *     dimensions for THIS product's audience)
 *   - icp_categories (valid category labels the scorer picks from)
 *   - icp_partner_type (the partner_type to set on scored rows)
 *   - icp_reject_categories (categories that auto-cap at 0–2)
 *   - icp_special_cases (exceptions to the reject list)
 *
 * The product MUST already have its basic fields populated (use
 * /api/agent/autofill-product first). This generator builds on top of
 * those fields rather than re-inferring them.
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { meterTokens } from '@/lib/usage/events';

export interface RubricProductContext {
  name: string;
  one_sentence_description: string | null;
  product_pitch: string | null;
  core_mechanism: string | null;
  customer_outcomes: string | null;
  icp_buyer_title: string | null;
  icp_verticals: string | null;
  icp_company_size: string | null;
  icp_stage: string | null;
  partner_types: string | null;
  asset_class: string | null;
  geography: string | null;
  ticket_size_min_label: string | null;
  ticket_size_max_label: string | null;
  exclusions: string | null;
}

/**
 * Project-side rubric context. Same shape as product but reads from the
 * fundraising-specific fields (investment_thesis, sponsor, target_round,
 * round_size_label) added in migration 022. The prompt swap is what
 * makes the generated rubric investor-flavoured rather than customer.
 */
export interface RubricProjectContext {
  name: string;
  description: string | null;
  investment_thesis: string | null;
  sponsor: string | null;
  project_type: string | null;
  funding_target: string | null;
  target_round: string | null;
  round_size_label: string | null;
  geography: string | null;
  asset_class: string | null;
  exclusions: string | null;
  icp_buyer_title: string | null;
  partner_types: string | null;
}

/**
 * Knowledge base sources uploaded against this product (PDF parses, URL
 * scrapes, pasted text). Caller fetches from product_sources WHERE
 * processing_status='completed' and passes through. Capped at 12000 chars
 * total inside buildUserMessage to keep the prompt within token budget.
 */
export interface KbSource {
  title: string;
  content: string | null;
}

export interface GenerateRubricResult {
  scoring_rubric: string;
  icp_categories: string[];
  icp_partner_type: string;
  icp_reject_categories: string[];
  icp_special_cases: string[];
}

export type RubricKind = 'product' | 'project';

const SYSTEM_PROMPT_PRODUCT = `You are a sales/partner ICP designer. Given a PRODUCT profile, write the scoring configuration the discovery engine uses to find and rank the right CUSTOMERS or CHANNEL PARTNERS for this product. The target is the BUYER who would PAY for the product, or a referral/integration partner who would route customers to it. Never confuse this with investor outreach.

The discovery engine scores every candidate on 5 dimensions (each 1–10):
  1. audience_overlap   — does the candidate's audience / role match the product's buyer / user
  2. complementarity    — does the candidate's focus align with this product's vertical / stage / use case
  3. partner_readiness  — does the candidate have decision authority + budget cycle to buy or partner now
  4. reachability       — geographic fit + likelihood of getting a response
  5. strategic_leverage — track record of buying / referring / integrating similar products

The weighted score lives in JS: 30% audience_overlap + 25% complementarity + 15% partner_readiness + 15% reachability + 15% strategic_leverage. You don't need to compute weights — just describe what high vs low looks like per dimension.

Write the rubric in the SAME structural style as this F2K example (a senior-debt fund) — bullet per dimension, with the weight, what 10/10 looks like, what 5-7 looks like, what 1-4 looks like:

  - audience_overlap_score (weight 30% — CAPITAL + TICKET FIT): Does this lender write $1M-$5M cheques into private debt? 10/10 = documented $2-5M tickets regularly; capacity for $5M+. 5-7 = writes private debt but ticket size unclear or smaller. 1-4 = equity-only or institutional-scale only.
  - complementarity_score (weight 25% — ASSET CLASS FOCUS): ...

Re-write each dimension for THIS PRODUCT'S target buyer / channel partner (e.g. HR Directors, VPs of Sales, integration partners, resellers, distributors). Keep the prose concrete and scannable.

Also produce:
  - icp_categories: 4–8 short labels of the kinds of CUSTOMER/PARTNER firms Claude should classify candidates into (e.g. "Enterprise HR teams 500+", "Mid-market SaaS distributor", "Boutique consultancy with EdTech vertical"). Keep each label tight.
  - icp_partner_type: ONE string the database will store on each scored partner. Common values for sales: "customer", "buyer", "reseller", "channel_partner", "referral", "integration_partner", "advisor", "strategic". Pick the one that fits.
  - icp_reject_categories: 4–10 categories that should AUTO-CAP scores at 0-2 (wrong audience). Be specific about what's out of scope based on the product's "Exclusions" field if present.
  - icp_special_cases: 0–4 explicit exceptions — cases where a candidate looks rejectable but isn't. Empty array is fine.

Return ONLY this JSON shape (no markdown, no fences):
{
  "scoring_rubric": "<multi-line text, exactly the style above>",
  "icp_categories": ["...", "..."],
  "icp_partner_type": "<one string>",
  "icp_reject_categories": ["...", "..."],
  "icp_special_cases": ["...", "..."]
}`;

const SYSTEM_PROMPT_PROJECT = `You are an investor / capital-provider ICP designer. Given a PROJECT profile (fundraising vehicle — equity raise, debt syndication, fund LP commitment, strategic partnership), write the scoring configuration the discovery engine uses to find and rank the right CAPITAL PROVIDERS for this project. The target is the INVESTOR / LENDER who would write a cheque, sign a term sheet, or commit to the facility. Never confuse this with sales / customer outreach.

The discovery engine scores every candidate on 5 dimensions (each 1–10):
  1. audience_overlap   — does the candidate write cheques of the right size and structure
  2. complementarity    — does the candidate's mandate align with this project's asset class / geography / stage
  3. partner_readiness  — does the candidate have decision authority + active deal cadence
  4. reachability       — geographic fit + likelihood of getting a credit / IC conversation
  5. strategic_leverage — track record of comparable deals / facilities / investments in past 24-36 months

The weighted score lives in JS: 30% audience_overlap + 25% complementarity + 15% partner_readiness + 15% reachability + 15% strategic_leverage. You don't need to compute weights — just describe what high vs low looks like per dimension.

Write the rubric in the F2K example style (a senior-debt fund) — bullet per dimension, with the weight, what 10/10 looks like, what 5-7 looks like, what 1-4 looks like:

  - audience_overlap_score (weight 30% — CAPITAL + TICKET FIT): Does this lender write $1M-$5M cheques into private debt? 10/10 = documented $2-5M tickets regularly; capacity for $5M+. 5-7 = writes private debt but ticket size unclear or smaller. 1-4 = equity-only or institutional-scale only.
  - complementarity_score (weight 25% — ASSET CLASS FOCUS): ...

Re-write each dimension for THIS project's investor audience (VCs at the right stage, family offices, private credit funds, lenders with the right ticket band — read the project details and infer). Keep the prose concrete and scannable.

Also produce:
  - icp_categories: 4–8 short labels of the kinds of investors Claude should classify candidates into (e.g. "Seed-stage SaaS VC", "Single family office private debt allocator", "Multi-strategy growth fund"). Keep each label tight.
  - icp_partner_type: ONE string the database will store on each scored partner. Common values for investor side: "investor", "vc", "lender", "lp", "family_office", "strategic". Pick the one that fits.
  - icp_reject_categories: 4–10 categories that should AUTO-CAP scores at 0-2 (wrong audience). Be specific about what's out of scope based on the project's "Exclusions" field if present.
  - icp_special_cases: 0–4 explicit exceptions — cases where a candidate looks rejectable but isn't (e.g. "Large generalist VCs IF they have a dedicated EdTech team"). Empty array is fine.

Return ONLY this JSON shape (no markdown, no fences):
{
  "scoring_rubric": "<multi-line text, exactly the style above>",
  "icp_categories": ["...", "..."],
  "icp_partner_type": "<one string>",
  "icp_reject_categories": ["...", "..."],
  "icp_special_cases": ["...", "..."]
}`;

function buildProductUserMessage(p: RubricProductContext, kb: KbSource[]): string {
  // Cap KB at ~12000 chars total. Anneke's NDIS feedback showed how easy
  // it is to blow context budget when collateral is rich; chop per-source
  // and break early when over.
  let kbTotal = 0;
  const kbBlocks: string[] = [];
  for (const s of kb) {
    if (!s.content) continue;
    const remaining = 12_000 - kbTotal;
    if (remaining <= 200) break;
    const slice = s.content.slice(0, Math.min(4000, remaining));
    kbBlocks.push(`--- ${s.title} ---\n${slice}`);
    kbTotal += slice.length;
  }
  const kbSection = kbBlocks.length > 0
    ? `\n\nKNOWLEDGE BASE (verbatim excerpts from uploaded sources):\n\n${kbBlocks.join('\n\n')}\n\n(End of knowledge base)`
    : '\n\nKNOWLEDGE BASE: (empty — no sources uploaded; infer rubric from the product fields alone)';

  return `PRODUCT
Name: ${p.name}
One-line: ${p.one_sentence_description ?? '(none)'}
Pitch: ${p.product_pitch ?? '(none — fall back to one-line)'}
Mechanism: ${p.core_mechanism ?? '(none)'}
Customer outcomes (after 90 days): ${p.customer_outcomes ?? '(none)'}
ICP buyer title: ${p.icp_buyer_title ?? '(none)'}
ICP verticals: ${p.icp_verticals ?? '(none)'}
ICP company size: ${p.icp_company_size ?? '(none)'}
ICP stage: ${p.icp_stage ?? '(none)'}
Partner types we want to reach: ${p.partner_types ?? '(none)'}
Asset class: ${p.asset_class ?? '(none)'}
Geography: ${p.geography ?? '(none)'}
Ticket size band: ${[p.ticket_size_min_label, p.ticket_size_max_label].filter(Boolean).join(' – ') || '(none)'}
Exclusions (what NOT to target): ${p.exclusions ?? '(none)'}${kbSection}

Now write the scoring configuration. Return the JSON shape only.`;
}

function buildProjectUserMessage(p: RubricProjectContext, kb: KbSource[]): string {
  let kbTotal = 0;
  const kbBlocks: string[] = [];
  for (const s of kb) {
    if (!s.content) continue;
    const remaining = 12_000 - kbTotal;
    if (remaining <= 200) break;
    const slice = s.content.slice(0, Math.min(4000, remaining));
    kbBlocks.push(`--- ${s.title} ---\n${slice}`);
    kbTotal += slice.length;
  }
  const kbSection = kbBlocks.length > 0
    ? `\n\nKNOWLEDGE BASE (verbatim excerpts from uploaded investment materials — quote concrete numbers from these in the rubric where they help):\n\n${kbBlocks.join('\n\n')}\n\n(End of knowledge base)`
    : '\n\nKNOWLEDGE BASE: (empty — no investment materials uploaded; infer rubric from the project fields alone)';

  return `PROJECT (fundraising vehicle — discovering INVESTORS / CAPITAL PROVIDERS for this)
Name: ${p.name}
Sponsor: ${p.sponsor ?? '(none)'}
Description: ${p.description ?? '(none)'}
Investment thesis: ${p.investment_thesis ?? '(none — fall back to description)'}
Project type: ${p.project_type ?? '(none)'}
Target round / facility: ${p.target_round ?? '(none)'}
Target raise: ${p.round_size_label ?? p.funding_target ?? '(none)'}
Asset class: ${p.asset_class ?? '(none)'}
Geography: ${p.geography ?? '(none)'}
Investor types we want to reach: ${p.partner_types ?? '(none)'}
Buyer title at investor firm: ${p.icp_buyer_title ?? '(none)'}
Exclusions (what NOT to target): ${p.exclusions ?? '(none)'}${kbSection}

Now write the investor scoring configuration. Return the JSON shape only.`;
}

/**
 * Shared one-shot helper. Caller picks the system prompt + user message,
 * we run the call, parse the JSON, and validate the shape. Used by both
 * the product (sales) and project (investor) variants below.
 */
async function runRubricGeneration(
  systemPrompt: string,
  userMessage: string,
  meterFor?: { organisation_id: string; route: string },
): Promise<GenerateRubricResult> {
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    },
    // 45s timeout — prompts with full KB attached run 15–30s on OpenRouter,
    // 20s was firing for non-trivial knowledge bases. Route maxDuration=60
    // is the hard ceiling above us.
    { signal: AbortSignal.timeout(45_000) },
  );

  meterTokens(meterFor, response, MODEL);

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`LLM returned no JSON object: ${text.slice(0, 300)}`);
  }

  let parsed: {
    scoring_rubric?: string;
    icp_categories?: string[];
    icp_partner_type?: string;
    icp_reject_categories?: string[];
    icp_special_cases?: string[];
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${jsonMatch[0].slice(0, 300)}`);
  }

  if (!parsed.scoring_rubric || !parsed.icp_partner_type) {
    throw new Error('LLM response missing scoring_rubric or icp_partner_type');
  }

  return {
    scoring_rubric: parsed.scoring_rubric.trim(),
    icp_categories: Array.isArray(parsed.icp_categories) ? parsed.icp_categories.filter((c) => typeof c === 'string') : [],
    icp_partner_type: parsed.icp_partner_type.trim(),
    icp_reject_categories: Array.isArray(parsed.icp_reject_categories) ? parsed.icp_reject_categories.filter((c) => typeof c === 'string') : [],
    icp_special_cases: Array.isArray(parsed.icp_special_cases) ? parsed.icp_special_cases.filter((c) => typeof c === 'string') : [],
  };
}

/**
 * Product (sales) variant — used by /api/products/generate-scoring-rubric.
 * Generates a customer/channel-partner ICP rubric.
 */
export async function generateScoringRubric(
  product: RubricProductContext,
  kb: KbSource[] = [],
  meterFor?: { organisation_id: string; route: string },
): Promise<GenerateRubricResult> {
  if (!product.product_pitch && !product.one_sentence_description) {
    throw new Error(
      'Product needs at least a one-line description or pitch before a scoring rubric can be generated. Visit /products to fill it in.',
    );
  }
  return runRubricGeneration(SYSTEM_PROMPT_PRODUCT, buildProductUserMessage(product, kb), meterFor);
}

/**
 * Project (fundraising) variant — used by /api/projects/generate-scoring-rubric.
 * Generates an investor / capital-provider ICP rubric.
 */
export async function generateInvestorScoringRubric(
  project: RubricProjectContext,
  kb: KbSource[] = [],
  meterFor?: { organisation_id: string; route: string },
): Promise<GenerateRubricResult> {
  if (!project.investment_thesis && !project.description) {
    throw new Error(
      'Project needs at least a description or investment thesis before an investor rubric can be generated. Visit /projects to fill it in.',
    );
  }
  return runRubricGeneration(SYSTEM_PROMPT_PROJECT, buildProjectUserMessage(project, kb), meterFor);
}
