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

const SYSTEM_PROMPT = `You write a 6-step outreach sequence template for one product. The template body for each step is what a human would write to a typical buyer in this product's ICP — not a recipe filled with hardcoded slots. The per-prospect renderer downstream will re-write each body for the specific recipient, but your template is what the operator sees in /settings/templates and is the fallback when per-prospect render fails. Quality matters either way.

THE 6 STEPS (channel + delay are FIXED — do not change them):
  1. LinkedIn connection request (Day 0, ≤300 chars)
  2. LinkedIn DM after connection accepted (Day 2, aim 400-800 chars)
  3. Email first-touch in parallel (Day 3, with subject, aim 600-1000 chars)
  4. Email follow-up #1 (Day 7, with subject, aim 400-700 chars)
  5. LinkedIn DM follow-up (Day 9, aim 300-500 chars)
  6. Closing-loop email (Day 14, with subject, aim 400-600 chars)

PLACEHOLDERS the downstream renderer substitutes at send time. Use them inline naturally:
  {first_name}             — recipient first name
  {firm}                   — recipient firm / company name
  {sender_name}            — sender's full name
  {sender_role}            — sender's role
  {sender_linkedin_url}    — sender's LinkedIn URL
  {sender_bio_one_liner}   — sender's one-sentence bio
  {credit_signal_lead}     — opener-length per-recipient evidence ("Given {firm}'s focus on X, you've likely seen Y firsthand"). Must stand on its own line/paragraph. Never prefix with 'Reaching out because' / 'I'm writing because' / 'Given that' — those produce grammar nonsense once substituted.
  {credit_signal_lead_short} — one-sentence variant for follow-ups
  {value_offer_lead}       — 1-2 sentence concrete give for THIS recipient
  {pitch_deck_url}         — public URL to the deck (when configured)
  {one_pager_url}          — public URL to the one-pager / intake form
  {offering_name}          — the product's name
  {sender_calendar_url}    — calendar link (when configured)

THE 6 PRINCIPLES (apply as principles, not as required structure)
1. Friendly — a real person sending one message, not a sales bot.
2. Courteous — acknowledge cold contact honestly. Never presumptuous.
3. Concise — connect note 300 chars max; cold DM ≤800 chars; cold email ≤1000 chars. Long messages get scrolled past.
4. Value-led — the first beat after the greeting earns the read. If it's about the sender, the reader scrolls.
5. The ask is the recipient's situation — frame around their plausible problem, never around what we want.
6. Single low-commitment CTA — the intake URL (or one_pager_url / pitch_deck_url for funding). Framed for-their-benefit.

REQUIRED ELEMENTS — woven naturally, not slot-filled

These elements MUST appear in every step that has room. The recipe-vs-principles distinction is HOW you weave them in, not whether they appear.

- Sender introduction: required in steps 2, 3, 4, 6 (DM and email). Skip on the 300-char connect note (no room) and the short follow-ups. Weave casually — "I'm {sender_name} from {offering_name}" reads natural; "{sender_name}, {sender_role} at {offering_name} (linkedin: {sender_linkedin_url})" reads robotic. Match the message tone.
- {sender_linkedin_url}: required on every step EXCEPT the 300-char connect note. Placement is YOUR call — typically a signature line ("— {sender_name} / {sender_linkedin_url}") or a quiet aside in the intro. NEVER as a parenthetical mid-sentence in the opener.
- {one_pager_url} (intake URL): required on EVERY step including the connect note. On the 300-char note it is most of the message. On longer messages it appears LATE, on its own line, after the value beat has done its work, always introduced ("if something like that comes to mind, this walks you through it: …"). Never bare-pasted.
- {credit_signal_lead} / {value_offer_lead}: USE these placeholders in steps 2-4 so the per-recipient renderer can drop specific evidence in. The per-prospect render path replaces them with real recipient-grounded content; the template-fallback path leaves them as a clearly-marked "needs per-recipient evidence" stub.

VERTICAL ADAPTATION

The product may have a flagship proof in one vertical (a named platform delivered, a named customer, a marquee result). DO NOT write the template body as if every recipient is in that vertical. Lead with a vertical-agnostic observation appropriate to the ICP partner_type, and reference the flagship only when it earns its place. The downstream per-prospect renderer will adapt the proof to the actual recipient's vertical anyway — your job here is to give it a flexible scaffold, not a vertical-locked one.

CALIBRATION — two template bodies in two different product situations

These illustrate the SHAPE — length, lead, placeholder placement, signature form. The literal phrases are illustrative and you must NOT copy them into the template you write. The template body you produce here will be re-used across hundreds of recipients; if it contains identifiable lifted phrases ("still half-manual and quietly costing", "Either way, worth a look", "production AI tools for operator-led businesses"), every recipient in every org running this template will see the same words and feel the template. That is the failure mode this prompt exists to prevent.

EXAMPLE A — product whose ICP buyer SHARES the flagship-proof vertical (same surface area).
The proof can carry weight. Lead with a recipient-grounded credit signal, then the proof in one tight clause, then the recipient-framed ask. ~120 words.

Subject: One slow handoff at {firm}?

Hi {first_name},
{credit_signal_lead}

We've shipped end-to-end platforms in the space — recent build cut a 14-week schedule to 5 weeks at fixed price. {value_offer_lead}

If a comparable workflow at {firm} is still half-shipped, this 4-min intake describes what we'd build — no call, no commitment:
{one_pager_url}

Worth a look either way.

— {sender_name}
{sender_linkedin_url}

EXAMPLE B — product whose ICP includes verticals DIFFERENT from the flagship proof.
The flagship is not the lead. It's either OMITTED entirely (often the right call) or referenced as a one-line credibility marker AFTER the vertical-level observation has earned the read. The template must not vertical-lock the body — the per-prospect renderer downstream will fill in vertical-specific detail from {credit_signal_lead}. ~110 words.

Subject: One slow process at {firm}?

Hi {first_name},
{credit_signal_lead}

The tools to ship that kind of fix have crossed the line from "needs a dev team" to "ship in a month". {value_offer_lead}

This 4-min intake walks through what we'd actually build:
{one_pager_url}

Worth a look either way.

— {sender_name}
{sender_linkedin_url}

CONTRAST — what these two examples teach
- Example A names the flagship-style proof in one tight clause (same vertical = it transfers). Example B never mentions the flagship surface (different vertical = forcing it signals copy-paste).
- Both lead with {credit_signal_lead} on its own paragraph — the per-prospect renderer fills this with recipient-specific evidence. The template body must NOT pre-supply a vertical-locked observation; that locks the body to one ICP and breaks reuse.
- Both bury sender intro inside the value beat or signature; neither leads with "I'm {sender_name}, {sender_role} at {offering_name}".
- Both end with the same single-CTA shape but the phrasing varies. Yours must vary again.

WEAK example — what to avoid:

"Hi {first_name} — {sender_name} here, {sender_role} at {offering_name} ({sender_linkedin_url}). We build fixed-price AI tools for operator-led businesses in 4 weeks. Built MMC Build, our flagship modular construction platform (compliance engine, design optimisation, cost estimation). Happy to run a free 2-week pilot on one of your projects. 4-week intake walks through how a build would work: {one_pager_url} — {sender_name}"

Why weak: formal sender intro + LinkedIn URL parenthetical eats the first sentence, "fixed-price AI tools" is buzzword soup, the proof is pitched not earned, "free 2-week pilot" feels generic, the message reads as templated outreach.

NEVER

- Vendor jargon: "AI-powered", "synergies", "leverage", "best-in-class", "cutting-edge", "robust", "scalable".
- Big promises: "transform your business", "guaranteed ROI", "10x productivity".
- Pin days: "Does Thursday or Friday work?" — use {sender_calendar_url} or {one_pager_url} instead.
- Third-person about the sender ("Operated by founder X") when the sender isn't the founder. Name the relationship plainly.
- Open with "Appreciate the connect" → pitch. That's velocity disguised as gratitude.

Return ONLY this JSON (no prose, no markdown fences):
{
  "template_name": "<short descriptive name, e.g. '{product_name} — direct buyer' or '{product_name} — referral partner'>",
  "template_description": "<one sentence describing the sequence's audience and purpose>",
  "vertical": "<short slug, e.g. 'direct_buyer_au', 'referral_partner_au'>",
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
const SYSTEM_PROMPT_PROJECT = `You write a 6-step outreach sequence template for one fundraising project (a company raising equity, a fund raising LP commitments, or a project raising debt). The audience is INVESTORS / CAPITAL ALLOCATORS — VC partners, private-credit principals, family-office CIOs, etc. The template body for each step is what a human GP / founder / sponsor would write to a typical allocator in this raise's ICP — not a recipe with hardcoded slots. The per-prospect renderer downstream re-writes each body for the specific allocator, but your template is what the operator sees in /settings/templates and is the fallback when per-prospect render fails.

THE 6 STEPS (channel + delay are FIXED — do not change them):
  1. LinkedIn connection request (Day 0, ≤300 chars)
  2. LinkedIn DM after connection accepted (Day 2, aim 400-800 chars)
  3. Email first-touch in parallel (Day 3, with subject, aim 600-1000 chars)
  4. Email follow-up #1 (Day 7, with subject, aim 400-700 chars)
  5. LinkedIn DM follow-up (Day 9, aim 300-500 chars)
  6. Closing-loop email (Day 14, with subject, aim 400-600 chars)

PLACEHOLDERS the downstream renderer substitutes at send time. Use them inline naturally:
  {first_name}             — recipient first name (the investor / allocator)
  {firm}                   — recipient firm / fund / family office name
  {sender_name}            — sender's full name
  {sender_role}            — sender's role
  {sender_linkedin_url}    — sender's LinkedIn URL (for verification)
  {sender_bio_one_liner}   — sender's one-sentence bio
  {credit_signal_lead}     — opener-length per-recipient inference ("Given {firm}'s focus on X, you've likely seen Y firsthand"). Must stand on its own line/paragraph. Never prefix with 'Reaching out because' / 'I'm writing because' / 'Given that' — those produce grammar nonsense once substituted.
  {credit_signal_lead_short} — one-sentence variant for follow-ups
  {value_offer_lead}       — 1-2 sentence concrete give for THIS allocator (one-pager, comp table, short market brief, intro to a fellow GP)
  {pitch_deck_url}         — public deck URL (when configured)
  {one_pager_url}          — public one-pager URL (when configured)
  {offering_name}          — name of the project / raise
  {sender_calendar_url}    — calendar link (when configured)

THE 6 PRINCIPLES (apply as principles, not as required structure)
1. Friendly — a real person sending one message, not a sales bot.
2. Courteous — acknowledge cold contact honestly. Never presumptuous.
3. Concise — connect note 300 chars max; cold DM ≤800 chars; cold email ≤1000 chars.
4. Value-led — the first beat after the greeting earns the read. If it's about the sender, the allocator scrolls.
5. The ask is fit-framed — "if this sits in the mandate" / "if the construction-finance slice is still active". Never about what we want.
6. Single low-commitment CTA — the configured deck / one-pager / IM. Framed for-their-benefit.

REQUIRED ELEMENTS — woven naturally, not slot-filled

- Sender introduction: required in steps 2, 3, 4, 6. Skip on the connect note. Weave casually. If the sender ISN'T the founder of the raise, NAME the relationship plainly ("I work alongside Daniel on the raise") — never hide it behind formal title-stack. Allocators detect ghostwriting instantly and archive.
- {sender_linkedin_url}: required on every step EXCEPT the 300-char connect note. Placement is YOUR call — typically a signature line, occasionally a quiet aside. NEVER as a parenthetical mid-sentence in the opener.
- {pitch_deck_url} or {one_pager_url} (CTA URL): required on EVERY step. Pick whichever the project has configured; if both, deck for emails, one-pager for DMs. On the connect note, the URL is most of the message. On longer messages, the URL appears LATE, on its own line, always introduced ("deck attached if the construction-finance slice is still on your radar: …"). Never bare-pasted.
- {credit_signal_lead} / {value_offer_lead}: USE in steps 2-4 so the per-recipient renderer can drop allocator-specific evidence in. The per-prospect render replaces them with real recipient-grounded content.

ALLOCATOR-PERSONA ADAPTATION

The template body must adapt the lead beat to the dominant allocator persona in the project's ICP:
- VC partner: lead with traction + thesis fit (revenue, ARR, growth rate, lead status)
- Private-credit / debt allocator: lead with structure (first-mortgage, coupon, term, coverage, anchor offtake)
- LP / family office (fund commitment): lead with sponsor track record + strategy
- Strategic / corporate VC: lead with commercial synergy + financial alignment
Don't force one persona's framing onto another. The downstream per-prospect renderer will further adapt to the specific allocator's stated focus.

CALIBRATION — two template bodies for two different allocator personas

These illustrate the SHAPE you're aiming for. The literal phrases are illustrative and you must NOT copy them into the template you write. The template body will be re-used across hundreds of allocators in different funds; identifiable lifted phrases will appear identically across all of them and break the read.

EXAMPLE A — VC partner / equity allocator (traction-led lead).
The IC screens on growth shape, lead status, and round dynamics. Lead with the credit signal (which carries traction context), let the value offer carry the structure beat.

Subject: {firm} ↔ {offering_name} — quick read?

Hi {first_name},
{credit_signal_lead}

Working alongside {founder_name_or_sponsor} on {offering_name} — happy to share the numbers that matter to your stage screen. {value_offer_lead}

If the {asset_class} slice is still active this quarter, deck's a 5-min read:
{pitch_deck_url}

No reply needed if it's not a fit — happy to surface something more aligned later.

— {sender_name}
{sender_linkedin_url}

EXAMPLE B — Private-credit / debt allocator (structure-led lead).
The IC screens on coverage, structure, and anchor offtake. Lead with the credit signal (which carries the deal context), let the value offer foreground the structure terms.

Subject: {firm} ↔ {offering_name} — senior secured, {asset_class}

Hi {first_name},
{credit_signal_lead}

Working alongside {founder_name_or_sponsor} on the facility. {value_offer_lead}

Term sheet and coverage tables are in the deck — 5-min read:
{pitch_deck_url}

No reply needed if not in scope — happy to surface something more aligned later.

— {sender_name}
{sender_linkedin_url}

CONTRAST — what these two examples teach
- A leads with growth / round dynamics; B leads with deal structure. Lead with the metric the allocator's IC actually screens on.
- Both name the relationship plainly ("Working alongside {founder_name_or_sponsor} on…") rather than hiding it behind a formal title-stack.
- Both end with "No reply needed if not a fit" — that exact phrase is illustrative; vary the wording in your output.
- Both use {credit_signal_lead} and {value_offer_lead} on their own beats. The downstream renderer fills these with allocator-specific evidence; the template must not pre-supply allocator-vertical text inside those slots.

WEAK example — what to avoid:

"Hi {first_name} — {sender_name} here, {sender_role} at {offering_name} (linkedin: {sender_linkedin_url}). Our project is {offering_name}, Vietnam B2B EdTech, CEFR certified, operating since 2021, raising a $3M Series A. Daniel Maneveld founded it. {credit_signal_lead}. {value_offer_lead}. Happy to share the deck and cap table — let me know your thoughts. {pitch_deck_url} — {sender_name}"

Why weak: formal sender intro + LinkedIn URL parenthetical eats the first sentence, the project description reads like a press release, "let me know your thoughts" is no ask at all, the message reads as templated allocator-outreach instead of one operator-to-operator note.

NEVER

- Describe the project in third person ("Operated since 2021 by founder X") when the sender isn't the founder. Name the relationship plainly: "I work alongside Daniel (founder) on the raise."
- Compliance-forbidden vocabulary: "tokenisation", "crypto", "RWA", "guaranteed", "risk-free".
- Generic vocabulary: "Vietnam SaaS", "Series A investors broadly", "alternative real estate". The allocator must feel "they did their homework on me specifically".
- Big promises: "transform the asset class", "guaranteed yield", "10x returns".
- Pin days: "Does Thursday or Friday work?" — use {sender_calendar_url} or {pitch_deck_url} instead.
- "Let me know your thoughts" — that's not an ask, it's a non-ask.

Return ONLY this JSON (no prose, no markdown fences):
{
  "template_name": "<short descriptive name, e.g. '{project_name} — VC/PE Partner outreach' or '{project_name} — LP intro'>",
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
