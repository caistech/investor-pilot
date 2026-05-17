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

/**
 * Knowledge base sources uploaded against this product. Caller fetches
 * from product_sources WHERE processing_status='completed' and passes
 * through; capped inside buildUserMessage to stay within token budget.
 */
export interface KbSource {
  title: string;
  content: string | null;
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

CORE:
  {first_name}             — recipient first name
  {firm}                   — recipient firm / company name
  {sender_name}             — sender's full name
  {sender_role}             — sender's role / title

WHO-AM-I (recipients ALWAYS look up the sender on LinkedIn first —
include the URL):
  {sender_linkedin_url}     — sender's LinkedIn URL. Use in step 2 + 3.
  {sender_bio_one_liner}    — sender's one-sentence bio. Use in step 3 email.

WHY-YOU (specific to this recipient — required everywhere except the
char-limited connect note):
  {credit_signal}            — one-clause reason this specific partner fits
  {credit_signal_lead}       — opener-length narrative ("Given {firm}'s focus on X…")
  {credit_signal_lead_short} — one-sentence variant for short follow-ups

WHAT-I-OFFER (give before take — REQUIRED in step 2, 3, 4):
  {value_offer}        — one-clause concrete give ("free pilot for your top customer" / "co-marketing post" / "referral commission write-up")
  {value_offer_lead}   — 1-2 sentence concrete offer

ATTACHMENT placeholders (surface upfront — beats "reply and I'll send it"):
  {pitch_deck_url}     — public URL to the deck. Use in step 3.
  {one_pager_url}      — public URL to the one-pager.
  {offering_name}      — the product's name.

ASK-LAST (small, optional, self-serve):
  {sender_calendar_url} — sender's calendar link. Use "calendar link below if useful: {sender_calendar_url}" rather than "Does Thursday or Friday work?".

COURTESY CONTRACT — NON-NEGOTIABLE STRUCTURE FOR EVERY STEP

Every step body MUST follow this 5-element order. Skipping any element
is a failure of basic courtesy. The recipient is busy — earn the right
to ask for their time:

1. TIME-ACK    — one short line. "Quick one." / "Short note, know your
                 day is full." Skip on the 300-char connect note.
2. WHO-AM-I    — full identification. {sender_name}, {sender_role}, plus
                 the relationship to the offering. Include
                 {sender_linkedin_url} on first DM + first email so the
                 recipient can verify you're real before clicking
                 further. If the sender isn't the founder, NAME the
                 relationship ("I work alongside the founder on the
                 raise") — never hide it. Anonymous senders get
                 archived.
3. WHY-YOU     — specific reason for THIS prospect via
                 {credit_signal_lead}. Generic vocabulary fails.
4. WHAT-I-OFFER — concrete give BEFORE the ask via {value_offer_lead}.
                  Surface {pitch_deck_url} / {one_pager_url} as a
                  link, don't say "happy to send" without sending.
5. ASK-LAST    — small, optional, self-serve. Use
                 {sender_calendar_url} when present rather than
                 "Does Thursday or Friday work?".

WRITING RULES
- Speak in the sender's voice: founder/principal, direct, no marketing fluff, no superlatives.
- Reference the product's concrete details (mechanism, outcomes, ticket size, asset class, geography) where it helps the recipient assess fit fast.
- Cite numbers wherever the KB / product page contains them — ARR / customer count / growth rate. Generic placeholder language signals "no traction" to readers.
- DON'T open with "Appreciate the connect" then jump to the pitch — that's a velocity move toward the ask, not gratitude.
- DON'T write in third person about the founder ("Operated by founder X") when the sender isn't the founder. Name the relationship instead.
- DON'T list buzzwords ("unit economics, retention cohorts, enterprise pipeline" — every automated sender writes this). Specifics or nothing.
- Match the recipient persona inferred from icp_buyer_title + partner_types + product type.
- Stay under the step's char limit. No emoji, no markdown, no hashtags.

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

function buildUserMessage(product: GenerateProductContext, sender: GenerateSenderContext, kb: KbSource[]): string {
  let kbTotal = 0;
  const kbBlocks: string[] = [];
  for (const s of kb) {
    if (!s.content) continue;
    const remaining = 10_000 - kbTotal;
    if (remaining <= 200) break;
    const slice = s.content.slice(0, Math.min(3500, remaining));
    kbBlocks.push(`--- ${s.title} ---\n${slice}`);
    kbTotal += slice.length;
  }
  const kbSection = kbBlocks.length > 0
    ? `\n\nKNOWLEDGE BASE (verbatim excerpts from uploaded sources — quote concrete details from these in the outreach copy where they help establish credibility):\n\n${kbBlocks.join('\n\n')}\n\n(End of knowledge base)`
    : '';

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
Organisation: ${sender.organisation_name}${kbSection}

Now write the 6 step bodies. Use the placeholders exactly as specified. Return the JSON shape only.`;
}

/** Project-side variant — context for an investor outreach sequence (fundraising). */
export interface GenerateProjectContext {
  name: string;
  description: string | null;
  investment_thesis: string | null;
  sponsor: string | null;
  project_type: string | null;
  /** Migration 027 — fine-grained funding scenario slug (e.g. 'series_a', 'construction_debt_senior'). */
  funding_type?: string | null;
  /** Pre-resolved describe sentence for funding_type. Caller injects this from FUNDING_TYPE_BY_VALUE. */
  funding_type_describe?: string | null;
  target_round: string | null;
  round_size_label: string | null;
  funding_target: string | null;
  asset_class: string | null;
  geography: string | null;
  partner_types: string | null;
  icp_buyer_title: string | null;
}

/**
 * Investor-side system prompt. Distinct from the product (sales) prompt
 * above because the rhetorical mode is different: founder-to-investor /
 * GP-to-LP / credit principal-to-allocator, not channel-partner pitch.
 *
 * Calling the wrong prompt here was the root cause of the LingoPure
 * Series A demo run producing drafts like "we've built a tool that
 * collapses weeks of research" — Claude was leaning on the SALES prompt
 * and confabulating product-pitch language about the project.
 */
const SYSTEM_PROMPT_PROJECT = `You are an outreach sequence writer for fundraising. Given a project profile (a capital-raising vehicle — a company raising equity, a fund raising LP commitments, or a project raising debt) and the sender's identity, write the bodies (and subject lines, where applicable) for a 6-step outreach sequence the sender will use to reach investors / capital allocators who match this raise.

The 6 steps are FIXED in channel + delay (you do NOT change these):
  1. LinkedIn connection request (Day 0, ≤300 chars)
  2. LinkedIn DM after connection accepted (Day 2)
  3. Email first-touch in parallel (Day 3, with subject)
  4. Email follow-up #1 (Day 7, with subject)
  5. LinkedIn DM follow-up (Day 9)
  6. Closing-loop email (Day 14, with subject)

Each step body MUST use these placeholder variables exactly (the renderer substitutes them per-prospect at send time):

CORE — required in every step body:
  {first_name}             — recipient first name
  {firm}                   — recipient firm / fund / family office name
  {sender_name}            — sender's full name
  {sender_role}            — sender's role / title

WHO-AM-I placeholders (recipients ALWAYS look the sender up on LinkedIn
before responding — including the URL is basic courtesy AND a trust
signal):
  {sender_linkedin_url}    — sender's LinkedIn URL. INCLUDE in step 2
                              (LinkedIn DM) and step 3 (Email first).
  {sender_bio_one_liner}   — sender's one-sentence bio. Use in step 3
                              email when richer who-I-am is needed.

WHY-YOU placeholders (the hedged inference about why THIS specific
recipient might care — required in every step except step 1 connect note
which is char-limited):
  {credit_signal}            — one-clause reason ("their thesis / recent deal / stated focus")
  {credit_signal_lead}       — opener-length narrative ("Given {firm}'s focus on X, you've likely seen Y firsthand…")
  {credit_signal_lead_short} — short variant for follow-ups

WHAT-I-OFFER placeholders (the value we give BEFORE asking — REQUIRED in
step 2, step 3, step 4):
  {value_offer}        — one-clause concrete give
  {value_offer_lead}   — 1-2 sentence concrete offer of help

ATTACHMENT placeholders (use in step 3 onward — surfacing the deck
link upfront beats "reply and I'll send it"):
  {pitch_deck_url}     — public URL to the full deck. Include in step 3.
  {one_pager_url}      — public URL to the one-pager. Use as the
                          lighter-weight alternative when step 2's
                          LinkedIn DM has char budget.
  {offering_name}      — name of the project / raise (for clarity in
                          subject lines and openers)

ASK-LAST placeholders (the ask comes LAST, small and self-serve):
  {sender_calendar_url} — sender's calendar booking link. When present,
                           use "calendar link: {sender_calendar_url}"
                           rather than "Does Thursday or Friday work?".

COURTESY CONTRACT — NON-NEGOTIABLE STRUCTURE FOR EVERY STEP

Every step body MUST follow this 5-element structure, in this order.
Skipping any element is a failure of basic courtesy and the message
will be regenerated by the operator. The recipient is busy — earn
the right to ask for their time, in order:

1. TIME-ACK   — one short line acknowledging their attention is finite.
                Not "Hey, hope this finds you well" (every cold sender
                writes that). Something like "Quick one — know your day
                is packed" or "Short note, won't take long" or for the
                connect-note skip this and go straight to (2).

2. WHO-AM-I   — full identification on first contact. {sender_name},
                {sender_role}, and the relationship to the offering /
                {firm_name}. If the sender isn't the founder, name it
                ("I work alongside the founder on the raise") — never
                hide the relationship. Anonymous senders get archived.
                On follow-ups, abbreviate: "{sender_name} again —"

3. WHY-YOU    — the specific personal reason this prospect, not 100
                others. Use {credit_signal_lead} which the renderer
                fills with a hedged inference from their evidence —
                "given {firm}'s stated focus on X, you've likely seen Y
                firsthand". Generic vocabulary ("Vietnam SaaS", "Series
                A investors broadly") fails this test. The reader must
                feel "they did their homework on me specifically".

4. WHAT-I-OFFER — concrete value with no commitment from them, BEFORE
                  the ask. Use {value_offer_lead}. Free pilot, market
                  brief, intro, one-pager, comp table — something the
                  reader takes away regardless of whether they engage
                  further. Required in step 2, 3, 4 — even when char
                  budget is tight.

5. ASK-LAST   — small, optional, specific. "Calendar link below if
                useful" / "happy to share the deck if you want to read
                first" / "20 minutes if a fit, no pressure if not".
                Never "Does Thursday or Friday work?" — that
                presumptuously books their calendar.

EXAMPLES OF THE STRUCTURE (project / investor side)

Step 2 (LinkedIn DM, ~200 words):
"{first_name} — short note, know your day is packed.

{sender_name} here, {sender_role} at the LingoPure raise (Daniel's the
founder, I'm working alongside him on outreach + technical diligence).

Reaching out because {credit_signal_lead}.

{value_offer_lead}

If it's useful, happy to send a one-pager + the cap table for context
— no obligation either way. If not a fit right now, no follow-up.

— {sender_name}"

Step 3 (Email first, with subject, ~180 words):
Subject: "{firm} ↔ LingoPure — quick note + one-pager if useful"

Body:
"{first_name},

Short note — know inbound's heavy.

I'm {sender_name}, {sender_role} at LingoPure (Vietnam B2B EdTech, CEFR
certified, operating since 2021, raising a $3M Series A). Daniel
Maneveld founded it; I'm working alongside him on the raise.

{credit_signal_lead}

{value_offer_lead}

If timing's right for a brief conversation on traction + structure, my
calendar link is below — pick whatever suits, including next month if
this week's a wash.

[Calendar link]

— {sender_name}
{sender_role}"

ADDITIONAL RULES

- The project IS the offering. Describe what it actually is using the
  project's specific language (sector, business model, geography,
  traction). DO NOT describe the project as a "discovery tool" or
  "platform that helps operators" unless that is literally what it is.
- Cite concrete numbers from the KB / investment thesis when present:
  revenue, ARR, growth rate, customer count, round size, valuation cap,
  lead status. Generic placeholder language signals "no traction".
- The ASK is investment-specific: a 20-min call, a one-pager / teaser,
  data room access, a deck. Never "let me know your thoughts".
- DON'T write in third person about the founder when the founder isn't
  the sender. Either the founder writes the message OR the sender names
  their relationship to the founder explicitly. "Operated since 2021
  by founder X" reads as a middleman press release; instead:
  "I work alongside Daniel (founder) on the raise."
- Match the persona inferred from icp_buyer_title + investor types:
    • VC partner → founder pitching their company; lead with traction + thesis fit
    • Private-credit allocator → credit principal pitching the facility; lead with first-mortgage / coverage / coupon
    • LP / family office → GP pitching the fund; lead with track record + strategy
- Stay under the step's char limit. No emoji, no markdown, no hashtags.
  British/Australian spelling where natural.

Return ONLY this JSON shape (no prose, no markdown fences):
{
  "template_name": "<short descriptive name, e.g. 'LingoPure Series A — VC/PE Partner outreach' or '{project_name} — LP intro'>",
  "template_description": "<one sentence describing the sequence's audience and purpose>",
  "vertical": "<short slug, e.g. 'vc_series_a', 'lp_intro_re_fund', 'senior_debt_au'>",
  "steps": [
    { "step_index": 1, "subject": null, "body": "..." },
    { "step_index": 2, "subject": null, "body": "..." },
    { "step_index": 3, "subject": "...", "body": "..." },
    { "step_index": 4, "subject": "...", "body": "..." },
    { "step_index": 5, "subject": null, "body": "..." },
    { "step_index": 6, "subject": "...", "body": "..." }
  ]
}`;

function buildProjectUserMessage(project: GenerateProjectContext, sender: GenerateSenderContext, kb: KbSource[]): string {
  let kbTotal = 0;
  const kbBlocks: string[] = [];
  for (const s of kb) {
    if (!s.content) continue;
    const remaining = 10_000 - kbTotal;
    if (remaining <= 200) break;
    const slice = s.content.slice(0, Math.min(3500, remaining));
    kbBlocks.push(`--- ${s.title} ---\n${slice}`);
    kbTotal += slice.length;
  }
  const kbSection = kbBlocks.length > 0
    ? `\n\nKNOWLEDGE BASE (verbatim excerpts from uploaded investment materials — quote concrete numbers, traction, and terms from these to make the pitch credible):\n\n${kbBlocks.join('\n\n')}\n\n(End of knowledge base)`
    : '';

  return `PROJECT (fundraising vehicle — writing outreach to INVESTORS / CAPITAL PROVIDERS)
Name: ${project.name}
Sponsor: ${project.sponsor ?? '(none)'}
Description: ${project.description ?? '(none)'}
Investment thesis: ${project.investment_thesis ?? '(none — fall back to description)'}
Funding type: ${project.funding_type_describe ?? project.funding_type ?? '(none)'}
Target round / facility: ${project.target_round ?? '(none)'}
Target raise: ${project.round_size_label ?? project.funding_target ?? '(none)'}
Asset class: ${project.asset_class ?? '(none)'}
Geography: ${project.geography ?? '(none)'}
Investor types to reach: ${project.partner_types ?? '(none)'}
Buyer title at investor firm: ${project.icp_buyer_title ?? '(none)'}

SENDER
Name: ${sender.sender_name}
Role: ${sender.sender_role}
Organisation: ${sender.organisation_name}${kbSection}

Write the 6 step bodies as INVESTOR outreach — credit-conversation / IC-meeting tone, not sales pitch. Lead with the concrete deal terms (size, structure, geography, sponsor track record). The CTA is always "20-minute credit / IC conversation". Use placeholders exactly. Return the JSON shape only.`;
}

export async function generateSequenceFromProduct(
  product: GenerateProductContext,
  sender: GenerateSenderContext,
  kb: KbSource[] = [],
  meterFor?: { organisation_id: string; route: string },
): Promise<GenerateSequenceResult> {
  if (!product.product_pitch && !product.one_sentence_description) {
    throw new Error(
      'Product needs at least a one-line description or pitch before a sequence can be generated. Visit /products to fill it in.',
    );
  }

  let response;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(product, sender, kb) }],
      },
      // 55s timeout, 5s under Vercel's 60s ceiling. Bumped from 45s after
      // operator hit the abort path on a heavy generation (LingoPure with
      // 2 KB PDFs attached, 2026-05-17). max_tokens cut from 4000 → 3000
      // to reduce expected wall time without affecting output quality
      // (6 short LinkedIn+email steps don't need more).
      { signal: AbortSignal.timeout(55_000) },
    );
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(
        'The LLM took longer than 55s to generate the sequence — usually means OpenRouter is congested or the KB attached is very large. Retry now (often clears on the second attempt), trim the largest KB source, or wait a minute.',
      );
    }
    throw err;
  }

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

  // Same courtesy-contract enforcement as the project-side generator.
  // Without this validation, LLM omissions silently propagate to every
  // rendered draft from this template until the operator re-generates.
  const contractErrors = validateCourtesyContract(steps);
  if (contractErrors.length > 0) {
    throw new Error(
      `Generated sequence violates the courtesy contract — the LLM skipped required elements. Retry generation (often clears on the second pass). Missing per step:\n${contractErrors.map((e) => `  • ${e}`).join('\n')}`,
    );
  }

  return {
    template_name: parsed.template_name?.trim() || `${product.name} — outreach`,
    template_description: parsed.template_description?.trim() || `Auto-generated outreach sequence for ${product.name}`,
    vertical: parsed.vertical?.trim() || 'auto_generated',
    steps,
  };
}

/**
 * Project-side variant — generates an INVESTOR outreach sequence (credit
 * conversation / IC meeting tone, not sales pitch). Used by
 * /api/projects/generate-sequence.
 */
export async function generateSequenceFromProject(
  project: GenerateProjectContext,
  sender: GenerateSenderContext,
  kb: KbSource[] = [],
  meterFor?: { organisation_id: string; route: string },
): Promise<GenerateSequenceResult> {
  if (!project.investment_thesis && !project.description) {
    throw new Error(
      'Project needs at least a description or investment thesis before an outreach sequence can be generated. Visit /projects to fill it in.',
    );
  }

  // 55s abort with 3000 max_tokens. The old 45s/4000 budget was tight
  // for Sonnet 4.5 via OpenRouter (saw ~50s wall-time with the LingoPure
  // KB attached on 2026-05-17). 55s sits 5s under Vercel's 60s ceiling
  // (set as the route's maxDuration) so the abort fires BEFORE Vercel
  // kills the function — gives us a clean catch-and-rethrow path.
  // 3000 tokens is plenty for 6 short LinkedIn + email steps; 4000 was
  // generous and just bought us extra wall-time on slow days.
  let response;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 3000,
        // Investor-side prompt — not SYSTEM_PROMPT (which is for sales).
        // Same call previously used SYSTEM_PROMPT, producing drafts like
        // "we've built a tool that collapses weeks of research" for a
        // VC-targeted raise. Fixed when SYSTEM_PROMPT_PROJECT landed.
        system: SYSTEM_PROMPT_PROJECT,
        messages: [{ role: 'user', content: buildProjectUserMessage(project, sender, kb) }],
      },
      { signal: AbortSignal.timeout(55_000) },
    );
  } catch (err) {
    // AbortSignal.timeout produces a DOMException-shaped error whose
    // message is the unhelpful "This operation was aborted" — translate
    // into something the operator can act on. Same shape for both the
    // SDK's AbortError and a plain timeout error.
    if (isAbortError(err)) {
      throw new Error(
        'The LLM took longer than 55s to generate the sequence — usually means OpenRouter is congested or the KB attached is very large. Retry now (often clears on the second attempt), trim the largest KB source, or wait a minute.',
      );
    }
    throw err;
  }

  meterTokens(meterFor, response, MODEL);

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`LLM returned no JSON object: ${text.slice(0, 300)}`);

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

  const steps: GeneratedStep[] = STEP_SCAFFOLD.map((scaffold) => {
    const written = parsed.steps?.find((s) => s.step_index === scaffold.step_index);
    if (!written?.body) throw new Error(`LLM omitted body for step ${scaffold.step_index}`);
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

  // Validate against the COURTESY CONTRACT before saving. The system
  // prompt explicitly demands 5-element structure (time-ack, who-am-i,
  // why-you, what-i-offer, ask-last), but the LLM intermittently skips
  // elements — operator hit this on the LingoPure $12M run where the
  // first two queued drafts both omitted sender introduction entirely.
  // Without this check, broken templates land in the DB and silently
  // propagate to every rendered message until manually re-generated.
  const contractErrors = validateCourtesyContract(steps);
  if (contractErrors.length > 0) {
    throw new Error(
      `Generated sequence violates the courtesy contract — the LLM skipped required elements. Retry generation (often clears on the second pass). Missing per step:\n${contractErrors.map((e) => `  • ${e}`).join('\n')}`,
    );
  }

  return {
    template_name: parsed.template_name?.trim() || `${project.name} — investor outreach`,
    template_description: parsed.template_description?.trim() || `Auto-generated investor outreach sequence for ${project.name}`,
    vertical: parsed.vertical?.trim() || 'auto_generated_investor',
    steps,
  };
}

/**
 * Validate the generated step bodies against the courtesy contract.
 *
 * Rules enforced (mirrors the system prompt's COURTESY CONTRACT block):
 *   - Step 1 (connect note, short) — exempt from WHO-AM-I requirement
 *     because there's no character budget; must still have {first_name}.
 *   - Steps 2-6 (DMs + emails) — MUST include {sender_name} (WHO-AM-I)
 *     and one of {credit_signal_lead|credit_signal} (WHY-YOU).
 *   - Steps 2-4 (first three substantive touches) — MUST also include
 *     one of {value_offer_lead|value_offer} (WHAT-I-OFFER). Follow-ups
 *     (5, 6) can drop the offer to keep the cadence light.
 *
 * Returns a list of human-readable error strings, one per missing
 * placeholder per step. Empty list = pass.
 */
function validateCourtesyContract(steps: GeneratedStep[]): string[] {
  const errors: string[] = [];
  for (const step of steps) {
    const body = step.body || '';
    const idx = step.step_index;

    // Every step must address the recipient.
    if (!body.includes('{first_name}')) {
      errors.push(`Step ${idx} (${step.template_key}) missing {first_name}`);
    }

    // Banned anti-patterns — explicitly named in the system prompt as
    // courtesy-contract violations but still appearing in generated
    // output. "Thursday or Friday" presumptuously books the recipient's
    // calendar; use {sender_calendar_url} for self-serve instead.
    const askedSpecificDays = /\b(thursday|friday|monday|tuesday|wednesday)\s+or\s+(thursday|friday|monday|tuesday|wednesday)\b/i.test(body)
      || /does\s+(this|next)\s+week\s+work/i.test(body)
      || /work\s+on\s+your\s+end\?/i.test(body);
    if (askedSpecificDays) {
      errors.push(`Step ${idx} (${step.template_key}) uses a presumptuous date-pinning close ("Thursday or Friday?" style). Use {sender_calendar_url} for self-serve booking instead.`);
    }

    // Step 1 is the short connect note — exempt from heavier rules.
    if (idx === 1) continue;

    // WHO-AM-I — sender must identify themselves.
    if (!body.includes('{sender_name}')) {
      errors.push(`Step ${idx} (${step.template_key}) missing WHO-AM-I — body must include {sender_name}`);
    }

    // WHY-YOU — personal reasoning grounded in evidence.
    const hasWhyYou = body.includes('{credit_signal_lead}') || body.includes('{credit_signal}') || body.includes('{credit_signal_lead_short}');
    if (!hasWhyYou) {
      errors.push(`Step ${idx} (${step.template_key}) missing WHY-YOU — body must include {credit_signal_lead} or {credit_signal}`);
    }

    // WHAT-I-OFFER — required on steps 2-4 (give-before-take cadence).
    // Follow-ups 5+ can omit to keep the chase light.
    if (idx >= 2 && idx <= 4) {
      const offerIdx = Math.min(
        ...['{value_offer_lead}', '{value_offer}'].map(p => {
          const i = body.indexOf(p);
          return i === -1 ? Infinity : i;
        }),
      );
      const hasOffer = offerIdx !== Infinity;
      if (!hasOffer) {
        errors.push(`Step ${idx} (${step.template_key}) missing WHAT-I-OFFER — body must include {value_offer_lead} or {value_offer}`);
      } else {
        // Ordering enforcement: offer MUST appear before any ask
        // phrasing in the body. The courtesy contract calls this out
        // explicitly ("concrete value… BEFORE the ask") but the LLM
        // routinely placed the offer paragraph after the ask anyway.
        const askPatterns = [
          /happy to walk/i,
          /happy to chat/i,
          /20-?minute/i,
          /quick call/i,
          /brief conversation/i,
          /\{sender_calendar_url\}/,
        ];
        const askIdx = Math.min(
          ...askPatterns.map(p => {
            const m = body.match(p);
            return m && typeof m.index === 'number' ? m.index : Infinity;
          }),
        );
        if (askIdx !== Infinity && offerIdx > askIdx) {
          errors.push(`Step ${idx} (${step.template_key}) places WHAT-I-OFFER after ASK-LAST. The offer must appear before the ask paragraph — earn the right to ask by giving first.`);
        }
      }
    }
  }
  return errors;
}

/**
 * Detect whether an error came from AbortSignal.timeout firing. Covers
 * both the SDK's AbortError (DOMException-shape) and a thrown Error whose
 * message literally says "aborted". The default message — "This
 * operation was aborted" — is not actionable on its own; callers
 * translate it to operator-readable copy before throwing onward.
 */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (typeof e.message === 'string' && /aborted|timeout/i.test(e.message)) return true;
  return false;
}
