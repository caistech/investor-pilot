/**
 * Synthesize a Project (fundraising) profile from interview answers.
 *
 * Parallel to the Product synthesizer but targets investor-side outreach.
 * Key differences from the product side:
 *
 * - Compliance vocabulary is load-bearing: any output containing
 *   "tokenisation", "crypto", "RWA", "guaranteed", or "risk-free" will be
 *   blocked downstream by the compliance regex. The synthesizer is
 *   explicitly instructed to strip these even if the operator's answer
 *   contained them.
 * - Allocator-persona framing matters: a VC partner reads traction first,
 *   a private credit principal reads structure first. The synthesizer
 *   prioritises the fields that match the dominant persona named.
 * - Sponsor and structure are non-negotiable for serious allocators.
 *   Missing sponsor = trust gap. Missing structure for debt = unallocable.
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import type { InterviewAnswer } from '@/lib/products/interview-synthesizer';

export interface SynthesizedProjectProfile {
  name: string;
  description: string;
  sponsor: string;
  funding_target: string;
  asset_class: string;
  geography: string;
  /** Free-text — operator picks the structured funding_type slug in the form. */
  funding_type_hint: string;
  core_mechanism: string;
  customer_outcomes: string;
  icp_company_size: string;
  icp_stage: string;
  icp_verticals: string;
  icp_buyer_title: string;
  icp_user_title: string;
  icp_stack_tools: string;
  traction_arr: string;
  traction_customers: string;
  partner_types: string;
  exclusions: string;
}

const SYSTEM_PROMPT = `You convert interview answers about a fundraising project into a structured project profile. The operator answered conversational questions about what they're raising, the structure, the sponsor, and the target investor. Your job is to extract the fields the InvestorPilot allocator-discovery system needs.

WHY THIS EXISTS

The previous flow had operators type free-form prose into 15+ separate project fields. Operators conflated "what we're raising for" with "what makes it good", and pitch text bled into ICP fields. The interview structure forces clean separation; your job is to keep that separation intact while producing structured output.

CRITICAL RULES

1. **Sponsor framing is the trust signal.** Capture the sponsor's track record EXACTLY as the operator stated it. Don't embellish. Don't add metrics they didn't claim. An allocator who detects exaggeration archives the message — better to look modest than puffed.

2. **Compliance vocabulary is FORBIDDEN.** Never emit:
   - "tokenisation" / "tokenization" / "token" / "tokenised"
   - "crypto" / "cryptocurrency" / "blockchain" (unless the operator's stated thesis is explicitly digital-asset focused)
   - "RWA" / "real-world asset" (as financial-product language)
   - "guaranteed" / "risk-free" / "guaranteed yield"
   - "passive income" (in the context of selling securities)
   If the operator's answer contained these, paraphrase to remove them. Output that includes them will be blocked by compliance regex before it can ship.

3. **Don't pluralise singular proofs.** If the sponsor mentioned ONE prior deal, frame as "we delivered X for Y" — don't write "we've delivered platforms like X" (plural) unless the operator listed multiple comparables.

4. **Asset class and geography must be specific.** "Real estate" alone is too broad; "U.S. residential construction debt" is right. "Asia" is too broad; "Singapore + Vietnam B2B SaaS" is right. If the operator wasn't specific, leave the field as the operator's exact text — don't manufacture specificity.

5. **investor_profile fields are about the INVESTOR**, not the project.
   - icp_company_size = fund size / AUM range (NOT how big the project is)
   - icp_stage = fund's deployment stage (NOT the project's stage)
   - icp_verticals = sectors the investor focuses on (NOT the project's sector)
   - icp_buyer_title = decision-maker title at the investor firm
   - icp_user_title = analyst / associate who screens deals first

6. **partner_types is one of: 'investor' / 'lender' / 'lp' / 'strategic'.**
   - Equity round → 'investor'
   - Debt facility → 'lender'
   - Fund commitment → 'lp'
   - Corporate / strategic investor → 'strategic'
   Pick the dominant one from the operator's answer. Default 'investor' if ambiguous.

7. **Don't invent specifics.** Empty is better than fabricated.

OUTPUT — return ONLY this JSON, no fences, no prose:

{
  "name": "<short project name from the 'raise' answer — 2-8 words>",
  "description": "<one to two sentences describing the project / vehicle / deal>",
  "sponsor": "<the operator + team + relevant track record, ≤2 sentences. Keep it modest and concrete.>",
  "funding_target": "<total raise size; empty string if not stated>",
  "asset_class": "<specific asset class slice; empty if not stated>",
  "geography": "<specific market(s); empty if not stated>",
  "funding_type_hint": "<one of: 'seed' / 'series_a' / 'series_b' / 'series_c_plus' / 'pre_seed' / 'construction_debt_senior' / 'construction_debt_mezz' / 're_fund_lp' / 'vc_fund_lp' / 'other'. Operator confirms in the form; this is just a hint.>",
  "core_mechanism": "<2-3 sentences on the investment thesis — what makes it work>",
  "customer_outcomes": "<empty string for fundraising projects unless the project itself produces a customer outcome relevant to the pitch>",
  "icp_company_size": "<investor fund size / AUM range; empty if not stated>",
  "icp_stage": "<investor fund stage — deploying / late-cycle / fund of funds; empty if not stated>",
  "icp_verticals": "<sectors the target investor focuses on; empty if not stated>",
  "icp_buyer_title": "<decision-maker title at investor firm (Partner / MD / Head of Credit / CIO etc.); empty if not stated>",
  "icp_user_title": "<analyst / associate title at investor firm; empty when not stated or identical to buyer>",
  "icp_stack_tools": "<empty string for fundraising projects unless explicitly relevant>",
  "traction_arr": "<traction line — proof points, sponsor track record, comparable deals. Keep modest. Empty if no concrete proof given.>",
  "traction_customers": "<named past deliveries / portfolio comps / referenceable LPs. Empty if no named items.>",
  "partner_types": "<'investor' | 'lender' | 'lp' | 'strategic' — see rule 6>",
  "exclusions": "<filter-out criteria; empty if operator didn't answer>"
}`;

function buildUserMessage(answers: InterviewAnswer[]): string {
  const formatted = answers
    .map(a => `--- Q (id=${a.question_id}): ${a.question_prompt}\n--- A: ${a.answer.trim()}`)
    .join('\n\n');
  return `Synthesize a fundraising project profile from the following interview answers. Return the JSON shape only.\n\n${formatted}`;
}

export async function synthesizeProjectProfile(
  answers: InterviewAnswer[],
): Promise<{ ok: true; profile: SynthesizedProjectProfile } | { ok: false; error: string }> {
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

  let parsed: Partial<SynthesizedProjectProfile>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, error: `LLM returned invalid JSON: ${jsonMatch[0].slice(0, 300)}` };
  }

  if (!parsed.name || typeof parsed.name !== 'string') {
    return { ok: false, error: 'Synthesis missing required field: name' };
  }

  // Last-line compliance scrub — the system prompt forbids this vocabulary
  // but Claude occasionally lets one slip through when the operator's input
  // contained it. Belt-and-braces: regex-strip the worst offenders from
  // every output field before returning. Operator can still type these
  // back in if they want; the synthesizer's job is to never introduce them.
  const FORBIDDEN_PATTERN = /\b(tokeni[sz]ed?|tokenisation|tokenization|guaranteed yield|risk[- ]free|RWA)\b/gi;
  const scrub = (s: string): string => (s || '').replace(FORBIDDEN_PATTERN, '[redacted]').trim();

  const partnerTypes = (parsed.partner_types || '').trim().toLowerCase();
  const validPartnerTypes = new Set(['investor', 'lender', 'lp', 'strategic']);
  const safePartnerTypes = validPartnerTypes.has(partnerTypes) ? partnerTypes : 'investor';

  const profile: SynthesizedProjectProfile = {
    name: scrub(parsed.name || ''),
    description: scrub(parsed.description || ''),
    sponsor: scrub(parsed.sponsor || ''),
    funding_target: (parsed.funding_target || '').trim(),
    asset_class: scrub(parsed.asset_class || ''),
    geography: (parsed.geography || '').trim(),
    funding_type_hint: (parsed.funding_type_hint || '').trim(),
    core_mechanism: scrub(parsed.core_mechanism || ''),
    customer_outcomes: scrub(parsed.customer_outcomes || ''),
    icp_company_size: (parsed.icp_company_size || '').trim(),
    icp_stage: (parsed.icp_stage || '').trim(),
    icp_verticals: (parsed.icp_verticals || '').trim(),
    icp_buyer_title: (parsed.icp_buyer_title || '').trim(),
    icp_user_title: (parsed.icp_user_title || '').trim(),
    icp_stack_tools: (parsed.icp_stack_tools || '').trim(),
    traction_arr: scrub(parsed.traction_arr || ''),
    traction_customers: scrub(parsed.traction_customers || ''),
    partner_types: safePartnerTypes,
    exclusions: scrub(parsed.exclusions || ''),
  };

  return { ok: true, profile };
}
