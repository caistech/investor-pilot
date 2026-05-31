/**
 * Synthesize a Product profile from conversational interview answers.
 *
 * Replaces the failure mode where operators typed prose like "Construction
 * leads deliberately — it's where MMC Build proves the model" into a
 * "verticals" field, which then bled into every downstream LLM call as
 * "MMC Build is our flagship modular platform". The interview answers are
 * benefit-framed (the questions force the right relationship); this
 * synthesizer turns them into the structured product fields without
 * silently re-introducing the mis-positioning.
 *
 * One Claude call. ~3-5s typical wall time.
 *
 * 2026-05-31: added `geography`. The interview now asks where the operator's
 * customers are; this carries that answer into products.geography so
 * discovery doesn't fall back to its US default. Per CRITICAL RULE 2 the
 * synthesizer must NOT invent a geography — empty string when the operator
 * didn't state one, since a hallucinated country is worse than null (null
 * triggers the documented, predictable US default in query-generator.ts).
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import type { InterviewQuestion } from './interview-questions';

export interface InterviewAnswer {
  /** Matches InterviewQuestion.id */
  question_id: string;
  /** The exact question prompt (for the system prompt context). */
  question_prompt: string;
  /** Operator's free-text answer. */
  answer: string;
}

export interface SynthesizedProductProfile {
  name: string;
  one_sentence_description: string;
  core_mechanism: string;
  customer_outcomes: string;
  icp_company_size: string;
  icp_stage: string;
  geography: string;
  icp_verticals: string;
  icp_buyer_title: string;
  icp_user_title: string;
  icp_stack_tools: string;
  traction_arr: string;
  traction_customers: string;
  exclusions: string;
}

const SYSTEM_PROMPT = `You convert interview answers about an operator's product into a structured product profile. The operator answered conversational questions; your job is to extract the structured fields the InvestorPilot prospecting system needs.

WHY THIS EXISTS

The previous flow had operators type free-form prose into 12+ separate fields. They wrote things like "Construction leads deliberately — it's where MMC Build proves the model" in a "verticals" field, intending it as orienting context. The downstream LLM read that as "MMC Build is our flagship modular product", which mis-positioned the entire outreach pipeline. The interview structure forces benefit-framed answers; your job here is to keep that framing intact while producing structured output.

CRITICAL RULES

1. **Preserve the operator's relationship to their case studies.** If the operator described a deliverable as "we built X for Y client" — keep that framing. NEVER convert "we built X for a modular operator" into "our flagship modular platform X" or "our product for modular operators". The sender is a build shop, not a productised vendor.

2. **Don't invent specifics.** If the operator didn't name a customer, vertical, company size, or geography, leave the corresponding field empty or use a sensible generic. Do NOT manufacture detail to fill a slot. Empty is better than fabricated. This applies especially to geography: if the operator did not state where their customers are, return an empty string — do NOT guess a country.

3. **Plural vs singular matters.** "We built X for a Texas logistics operator" → ONE client. Don't write it as "for logistics operators" (plural) — that implies a vertical product line.

4. **Be honest about what we don't know.** The "what we don't know" empty fields are signals to the operator that they should fill those in — better than a confidently-wrong synthesis.

5. **Geography is a market, not a head office.** Capture where the operator's TARGET CUSTOMERS operate, not where the operator themselves is based, when the answer distinguishes them. Normalise lightly to recognisable market terms (e.g. "Australia", "US & Canada", "UK and Ireland", "APAC", "global") rather than a long list of individual towns — but keep specific cities if that's the operator's actual targeting granularity.

OUTPUT — return ONLY this JSON, no fences, no prose:

{
  "name": "<short product/service name from the 'what' answer — 2-6 words>",
  "one_sentence_description": "<one sentence (under 200 chars) describing what the customer gets — benefit-led>",
  "core_mechanism": "<2-3 sentences on how delivery works — repeatable approach, format, structural details>",
  "customer_outcomes": "<2-3 sentences on what changes for the customer; concrete results over 90 days>",
  "icp_company_size": "<the employee band / revenue range / size description; empty string if not stated>",
  "icp_stage": "<growth stage description; empty string if not stated>",
  "geography": "<the market(s) the operator's customers are in, from the 'geography' answer; normalise to recognisable market terms; empty string if not stated — do NOT guess>",
  "icp_verticals": "<comma-separated industries with the dominant one called out if mentioned. Do NOT add 'X proves the model' style flagship-positioning text. Just industries.>",
  "icp_buyer_title": "<job title(s) of decision-maker; empty string if not stated>",
  "icp_user_title": "<job title(s) of actual user when different from buyer; empty string when not stated or identical to buyer>",
  "icp_stack_tools": "<tools the buyer typically already uses; empty string if not stated>",
  "traction_arr": "<traction line — proof points, deliveries, scale. Keep client-deliverable framing intact. Empty string if no concrete proof given.>",
  "traction_customers": "<comma-separated recent clients with relationship type. Format: 'Client Name (platform built: Platform Name)' when the proof point named both. Empty string if no named clients.>",
  "exclusions": "<filter-out criteria from the optional question; empty string if operator didn't answer that question>"
}`;

function buildUserMessage(answers: InterviewAnswer[]): string {
  const formatted = answers
    .map(a => `--- Q (id=${a.question_id}): ${a.question_prompt}\n--- A: ${a.answer.trim()}`)
    .join('\n\n');
  return `Synthesize a product profile from the following interview answers. Return the JSON shape only.\n\n${formatted}`;
}

export async function synthesizeProductProfile(
  answers: InterviewAnswer[],
): Promise<{ ok: true; profile: SynthesizedProductProfile } | { ok: false; error: string }> {
  if (answers.length === 0) {
    return { ok: false, error: 'No answers provided' };
  }

  let response;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(answers) }],
      },
      { signal: AbortSignal.timeout(30_000) },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, error: `LLM returned no JSON object: ${text.slice(0, 300)}` };
  }

  let parsed: Partial<SynthesizedProductProfile>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, error: `LLM returned invalid JSON: ${jsonMatch[0].slice(0, 300)}` };
  }

  if (!parsed.name || typeof parsed.name !== 'string') {
    return { ok: false, error: 'Synthesis missing required field: name' };
  }

  const profile: SynthesizedProductProfile = {
    name: (parsed.name || '').trim(),
    one_sentence_description: (parsed.one_sentence_description || '').trim(),
    core_mechanism: (parsed.core_mechanism || '').trim(),
    customer_outcomes: (parsed.customer_outcomes || '').trim(),
    icp_company_size: (parsed.icp_company_size || '').trim(),
    icp_stage: (parsed.icp_stage || '').trim(),
    geography: (parsed.geography || '').trim(),
    icp_verticals: (parsed.icp_verticals || '').trim(),
    icp_buyer_title: (parsed.icp_buyer_title || '').trim(),
    icp_user_title: (parsed.icp_user_title || '').trim(),
    icp_stack_tools: (parsed.icp_stack_tools || '').trim(),
    traction_arr: (parsed.traction_arr || '').trim(),
    traction_customers: (parsed.traction_customers || '').trim(),
    exclusions: (parsed.exclusions || '').trim(),
  };

  return { ok: true, profile };
}