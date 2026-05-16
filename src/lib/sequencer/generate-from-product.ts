/**
 * Generate a tailored sequence template from a product profile.
 *
 * Replaces the F2K-hardcoded SEED_TEMPLATES path for new tenants: takes a
 * product's pitch + ICP + the org's sender identity and one-shot Claude
 * writes the 6 outreach step bodies tuned to that audience. Same step
 * scaffold as the seed (linkedin_connect → dm_first → email_first → email_fu1
 * → linkedin_dm_fu → email_fu2) so the cron scheduler doesn't have to learn
 * a new shape.
 *
 * Variable conventions kept identical to seed templates so the existing
 * renderer (src/lib/sequencer/render.ts) substitutes them without changes:
 *   {first_name}              recipient first name
 *   {firm}                    recipient firm/company
 *   {sender_name}             from organisations.sender_name
 *   {sender_role}             from organisations.sender_role
 *   {credit_signal}           one-line "why this person is a fit" — extracted
 *                             per-partner by the renderer (legacy naming,
 *                             actually a generic fit signal)
 *   {credit_signal_lead}      same idea, opener-length narrative
 *   {credit_signal_lead_short} same idea, single sentence
 *
 * Wall-time: one Claude call per generation. ~4–8s typical. Caller should
 * call this on product create (auto) or via the "Regenerate" UI button.
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { meterTokens } from '@/lib/usage/events';

export interface GenerateProductContext {
  name: string;
  one_sentence_description: string | null;
  product_pitch: string | null;
  core_mechanism: string | null;
  customer_outcomes: string | null;
  icp_buyer_title: string | null;
  icp_verticals: string | null;
  icp_company_size: string | null;
  asset_class: string | null;
  geography: string | null;
  ticket_size_min_label: string | null;
  ticket_size_max_label: string | null;
  partner_types: string | null;
}

export interface GenerateSenderContext {
  sender_name: string;
  sender_role: string;
  organisation_name: string;
}

export interface GeneratedStep {
  step_index: number;
  channel: 'linkedin_connect' | 'linkedin_dm' | 'email';
  delay_days: number;
  template_key: string;
  description: string;
  subject: string | null;
  body: string;
  max_chars: number;
  is_warm: boolean;
}

export interface GenerateSequenceResult {
  template_name: string;
  template_description: string;
  vertical: string;
  steps: GeneratedStep[];
}

/**
 * Step scaffold — same shape as seed-templates so the scheduler + renderer
 * keep working. Each entry defines the structural constraints (channel,
 * delay, char limit). The LLM fills the subject + body.
 */
const STEP_SCAFFOLD = [
  { step_index: 1, channel: 'linkedin_connect' as const, delay_days: 0, template_key: 'auto_connect',     max_chars: 300,  has_subject: false, description: 'LinkedIn connection request — ≤300 chars per LinkedIn note limit' },
  { step_index: 2, channel: 'linkedin_dm'      as const, delay_days: 2, template_key: 'auto_dm_first',    max_chars: 2000, has_subject: false, description: 'First DM after connection accepted; concrete product specifics' },
  { step_index: 3, channel: 'email'            as const, delay_days: 3, template_key: 'auto_email_first', max_chars: 2500, has_subject: true,  description: 'Email first-touch (parallel path when contact has work email)' },
  { step_index: 4, channel: 'email'            as const, delay_days: 7, template_key: 'auto_email_fu1',   max_chars: 1200, has_subject: true,  description: 'Email follow-up 1 — short, references prior, low-friction CTA' },
  { step_index: 5, channel: 'linkedin_dm'      as const, delay_days: 9, template_key: 'auto_dm_fu',       max_chars: 600,  has_subject: false, description: 'DM follow-up — last LinkedIn touch before closing the loop' },
  { step_index: 6, channel: 'email'            as const, delay_days: 14,template_key: 'auto_email_fu2',   max_chars: 800,  has_subject: true,  description: 'Closing-loop email — graceful exit, door-open' },
] as const;

const SYSTEM_PROMPT = `You are an outreach sequence writer. Given a product profile and the sender's identity, write the bodies (and subject lines, where applicable) for a 6-step outreach sequence that the sender will use to reach the right kind of prospect for this product.

The 6 steps are FIXED in channel + delay (you do NOT change these):
  1. LinkedIn connection request (Day 0, ≤300 chars)
  2. LinkedIn DM after connection accepted (Day 2)
  3. Email first-touch in parallel (Day 3, with subject)
  4. Email follow-up #1 (Day 7, with subject)
  5. LinkedIn DM follow-up (Day 9)
  6. Closing-loop email (Day 14, with subject)

Each step body MUST use these placeholder variables exactly (the renderer substitutes them per-prospect at send time):
  {first_name}        — recipient first name
  {firm}              — recipient firm / company name
  {sender_name}       — sender's full name
  {sender_role}       — sender's role / title

You MAY use these per-prospect signal placeholders when natural — the renderer extracts them from each prospect's evidence per call:
  {credit_signal}            — short one-clause reason this specific prospect fits (use in connect + DM steps)
  {credit_signal_lead}       — opener-length narrative (use as the first sentence of cold email)
  {credit_signal_lead_short} — one-sentence variant (use in short follow-ups)

WRITING RULES
- Speak in the sender's voice: founder/principal, direct, no marketing fluff, no superlatives.
- Lead with substance: what the product actually is and what the recipient gets out of a conversation. NOT "I'd love to chat".
- Reference the product's concrete details (mechanism, outcomes, ticket size, asset class, geography) where it helps the recipient assess fit fast.
- Match the recipient persona inferred from icp_buyer_title + partner_types + product type. e.g. for "VC partner" sound like a founder pitching; for "credit allocator" sound like a credit principal; for "channel partner" sound like a head of BD.
- The CTA is always specific and low-friction: a 15–20 minute call, a brief reply, sharing a one-pager. Never "let me know your thoughts".
- Stay under the step's char limit.
- No emoji, no markdown, no hashtags.

Return ONLY this JSON shape (no prose, no markdown fences):
{
  "template_name": "<short descriptive name, e.g. 'LingoPure — VC outreach' or '{product_name} — direct lender'>",
  "template_description": "<one sentence describing the sequence's audience and purpose>",
  "vertical": "<short slug, e.g. 'vc_seed', 'senior_debt_au', 'channel_partner_au'>",
  "steps": [
    { "step_index": 1, "subject": null, "body": "..." },
    { "step_index": 2, "subject": null, "body": "..." },
    { "step_index": 3, "subject": "...", "body": "..." },
    { "step_index": 4, "subject": "...", "body": "..." },
    { "step_index": 5, "subject": null, "body": "..." },
    { "step_index": 6, "subject": "...", "body": "..." }
  ]
}`;

function buildUserMessage(product: GenerateProductContext, sender: GenerateSenderContext): string {
  return `PRODUCT
Name: ${product.name}
One-line: ${product.one_sentence_description ?? '(none)'}
Pitch: ${product.product_pitch ?? '(none — fall back to one-line)'}
Mechanism: ${product.core_mechanism ?? '(none)'}
Customer outcomes (what changes after 90 days): ${product.customer_outcomes ?? '(none)'}
ICP buyer title: ${product.icp_buyer_title ?? '(none)'}
ICP verticals: ${product.icp_verticals ?? '(none)'}
ICP company size: ${product.icp_company_size ?? '(none)'}
Asset class: ${product.asset_class ?? '(none)'}
Geography: ${product.geography ?? '(none)'}
Ticket size band: ${[product.ticket_size_min_label, product.ticket_size_max_label].filter(Boolean).join(' – ') || '(none)'}
Partner types we want to reach: ${product.partner_types ?? '(none)'}

SENDER
Name: ${sender.sender_name}
Role: ${sender.sender_role}
Organisation: ${sender.organisation_name}

Now write the 6 step bodies. Use the placeholders exactly as specified. Return the JSON shape only.`;
}

export async function generateSequenceFromProduct(
  product: GenerateProductContext,
  sender: GenerateSenderContext,
  meterFor?: { organisation_id: string; route: string },
): Promise<GenerateSequenceResult> {
  if (!product.product_pitch && !product.one_sentence_description) {
    throw new Error(
      'Product needs at least a one-line description or pitch before a sequence can be generated. Visit /products to fill it in.',
    );
  }

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(product, sender) }],
    },
    { signal: AbortSignal.timeout(20_000) },
  );

  meterTokens(meterFor, response, MODEL);

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`LLM returned no JSON object: ${text.slice(0, 300)}`);
  }

  let parsed: {
    template_name?: string;
    template_description?: string;
    vertical?: string;
    steps?: Array<{ step_index?: number; subject?: string | null; body?: string }>;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${jsonMatch[0].slice(0, 300)}`);
  }

  if (!Array.isArray(parsed.steps) || parsed.steps.length !== STEP_SCAFFOLD.length) {
    throw new Error(`LLM returned ${parsed.steps?.length ?? 0} steps; expected ${STEP_SCAFFOLD.length}`);
  }

  // Merge the LLM-written content into the fixed scaffold. We trust the LLM
  // for subject + body; channel / delay / char-limit / template_key come
  // from the scaffold so the scheduler keeps working.
  const steps: GeneratedStep[] = STEP_SCAFFOLD.map((scaffold) => {
    const written = parsed.steps?.find((s) => s.step_index === scaffold.step_index);
    if (!written?.body) {
      throw new Error(`LLM omitted body for step ${scaffold.step_index}`);
    }
    return {
      step_index: scaffold.step_index,
      channel: scaffold.channel,
      delay_days: scaffold.delay_days,
      template_key: scaffold.template_key,
      description: scaffold.description,
      subject: scaffold.has_subject ? (written.subject ?? '') : null,
      body: written.body.trim(),
      max_chars: scaffold.max_chars,
      is_warm: false,
    };
  });

  return {
    template_name: parsed.template_name?.trim() || `${product.name} — outreach`,
    template_description: parsed.template_description?.trim() || `Auto-generated outreach sequence for ${product.name}`,
    vertical: parsed.vertical?.trim() || 'auto_generated',
    steps,
  };
}
