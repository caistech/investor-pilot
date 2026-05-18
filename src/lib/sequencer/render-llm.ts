/**
 * Per-prospect LLM message render.
 *
 * Replaces the mechanical placeholder substitution path in render.ts.
 * One LLM call per (recipient, step) — the LLM receives the messaging
 * framework + offering profile + recipient profile + sender identity +
 * step constraints (channel, max_chars, has_subject, tier, warm) and
 * writes the complete subject + body, ready for compliance check.
 *
 * Why this exists:
 *   The old path was a Mad Lib — the LLM wrote a template body with
 *   {placeholders} and the renderer mechanically substituted strings
 *   afterwards. The LLM never saw "Keep Modular" when writing the
 *   sentence "Worth a look if {firm} has a workflow that's costing
 *   you" — so the final message read like an obvious template.
 *   This module lets the LLM see the actual recipient before writing
 *   each sentence, producing coherent, vertical-adapted, tier-aware
 *   prose that reads like a human wrote it.
 *
 * What stays in render.ts:
 *   - Contact-name validation + honorific stripping + first-name extraction
 *   - Credit-signal extraction (CreditSignal becomes an LLM input here)
 *   - Warm-opener extraction (for 1st-degree LI partners)
 *   - Smart {firm} fallback computation
 *   - Compliance regex on the rendered output
 *   - Tier badge computation
 *
 * Cost: ~$0.016 per render at Sonnet 4.5 pricing (3k in + 500 out).
 * Latency: ~3-5s per render. Callers chunk to stay under Vercel's 60s ceiling.
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import type { RenderPartner, RenderContext } from './render';

// =============================================================================
// Model tiers
// =============================================================================

/**
 * Pick a model tier for a step. First-touch messages (connect notes, first
 * DM, first email) use Sonnet for nuance — the recipient's first impression
 * is high-stakes. Follow-ups and closing-loop steps use Haiku — shorter,
 * more formulaic, the marginal quality gain from Sonnet doesn't justify
 * the 3× spend.
 *
 * Cost on a 50-prospect campaign × all 6 steps:
 *   - All Sonnet:                ~$5.40
 *   - First 3 Sonnet + last 3 Haiku: ~$3.60 (~33% saving)
 */
export function selectModelTier(template_key: string): 'sonnet' | 'haiku' {
  // Follow-up patterns — any key matching _fu, _final, _fu1, _fu2, dm_fu.
  if (/(?:_fu\d*|_final|dm_fu)$/i.test(template_key)) return 'haiku';
  // Everything else (connect, dm_first, email_first, warm_dm_first) is a
  // first-touch with high signal-density requirements.
  return 'sonnet';
}

/**
 * Resolve a tier name to the provider-specific model ID. The format differs
 * between OpenRouter (anthropic/claude-haiku-4.5) and direct Anthropic
 * (claude-haiku-4-5). We detect by sniffing the default model ID's prefix.
 */
export function modelIdForTier(tier: 'sonnet' | 'haiku'): string {
  const usingOpenRouter = MODEL.startsWith('anthropic/');
  if (tier === 'haiku') {
    return usingOpenRouter ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5';
  }
  // Sonnet — return the configured default rather than hardcoding. Lets the
  // operator override globally via AGENT_MODEL when wanting Opus or a
  // different Sonnet variant.
  return MODEL;
}

/** What we pass to the LLM. Mirrors the messaging framework's required inputs. */
export interface LLMRenderInput {
  channel: 'linkedin_connect' | 'linkedin_dm' | 'email';
  max_chars: number;
  has_subject: boolean;
  /** Score-driven tier — 'confident' / 'qualified' / 'exploratory'. Modulates hedging. */
  outreach_tier: 'confident' | 'qualified' | 'exploratory';
  /** Whether the partner is a 1st-degree LinkedIn connection. Drives Tier-1-warm tone. */
  warm: boolean;
  /** Resolved first name (post-honorific-strip, post-paren-name selection). */
  first_name: string;
  /** Resolved firm name (post-smart-fallback; 'your firm' when company_name == contact_name). */
  firm: string;
  /** The step's template_key — surfaces position in sequence (auto_connect / auto_dm_first / auto_email_fu1 / etc.). */
  template_key: string;
  /** Hedged inference about why this recipient is a fit. Generated upstream by extractCreditSignal. */
  signal: {
    short: string;
    lead: string;
    leadShort: string;
    valueOfferShort: string;
    valueOfferLead: string;
    specificity: 'specific_deal' | 'sector_evidence' | 'sector_anchor' | 'humble_intro';
  } | null;
  /** Tier-1 warm opener (1st-degree only). 'quick one.' fallback when generation fails. */
  warm_opener: string;
  /** Recipient + offering + sender — all flat for prompt simplicity. */
  partner: RenderPartner;
  context: RenderContext;
}

export interface LLMRenderResult {
  ok: true;
  subject: string | null;
  body: string;
  /** 1-10: how directly the body references THIS recipient (10 = quotes a recent post; 5 = vertical-level fit; 1 = generic). */
  personalization_score: number;
  /** Detected output language for the localisation badge — falls back to 'English'. */
  detected_language: string;
}

export interface LLMRenderError {
  ok: false;
  error: string;
}

// =============================================================================
// SYSTEM PROMPT — the messaging framework, condensed for runtime use
// =============================================================================

const SYSTEM_PROMPT = `You write one cold-outreach message at a time. Each call gives you a recipient, an offering, a sender, and a step. Write what THIS recipient should receive — not a template, not a recipe, not a checklist of beats. Read the inputs and write the message a thoughtful human would write to this specific person.

THE PROBLEM YOU'RE SOLVING

Most LLM-generated outreach reads like LLM-generated outreach because the prompt mandates a recipe (greeting + intro + proof + ask + CTA + signature) and the LLM dutifully fills every slot. The reader feels the template through the variation. Your job is the opposite: figure out what serves THIS recipient at THIS moment, then write that. The framework below is GUIDANCE, not slots to fill.

THE 6 PRINCIPLES (apply as principles, not as required elements)

1. Friendly — a real person sending one message, not a sales bot running a sequence.
2. Courteous — acknowledge that you're a stranger (cold) or semi-stranger (lukewarm). Never presumptuous.
3. Concise — 3-5 sentences for cold, slightly more room for warm. The reader should get the point in under 15 seconds. Long messages get scrolled past.
4. Value-led — the first beat after the greeting earns the read: a specific observation about them, a proof point you can substantiate, or a sharp insight about their industry. If the first beat is about you, the reader scrolls.
5. The ask is THEIRS — frame around their plausible problem (Sales) or their portfolio fit (Funding), never around what you want. "If a slow process comes to mind" not "happy to chat".
6. Single low-commitment CTA — the configured intake URL / deck / one-pager, framed for their benefit. "Walks you through it in a few minutes" beats "let's set up a call".

TIER LOGIC

- TIER 1 (1st-degree LinkedIn, warm=true): familiar. Reference the existing connection. Use the supplied warm_opener as the opener. You can be direct.
- TIER 2 (2nd-degree, lukewarm): warm but slightly more formal. Borrow credibility from proof or mutual signal.
- TIER 3 (cold LinkedIn, no bridge): polite, concise. The insight IS the value.
- TIER 4 (Brave / cold email): most courteous, tightest. Single CTA only. Acknowledge the cold contact honestly.

The outreach_tier dial (confident / qualified / exploratory) modulates hedging: exploratory says "not sure if this fits, but…", confident states the offer plainly.

CHANNEL LIMITS

- linkedin_connect: 300 chars MAX. The hardest constraint — no formal sender intro, no sender bio, no LinkedIn URL. One observation + one soft ask + URL inline if it fits + sign with sender's first name. Cap is from LinkedIn, not from style preference.
- linkedin_dm: 1500 chars MAX. Cold messages should land around 400-800 chars; warm Tier 1 has more room. Whether you include a sender intro line is YOUR call — sometimes the recipient cares who's writing, sometimes the opening insight earns the read better than "I'm X from Y".
- email: 1500 chars body + a subject. Subject ≤60 chars, leads with the recipient's name OR the firm OR an interesting hook — never "your firm" or "your company". Body length varies — strong proof + tight ask can land at 400 chars; a richer insight-led email can sit at 1000 chars.

REQUIRED ELEMENTS — but woven naturally, not slot-filled

These elements MUST appear in every message that has room for them. The recipe-vs-principles distinction is HOW you weave them in, not whether they appear. A human writer fits these naturally; they don't bolt them on as separate paragraphs.

- Sender introduction (name + one-line about who they are): required on every step except the 300-char connect note. The recipient must know who's writing. Weave it casually — "I'm Dennis from Corporate AI Solutions" works; "Dennis McMahon here, Director at Corporate AI Solutions (linkedin.com/in/denniskl)" reads like a corporate signature and breaks the tone.
- Sender's LinkedIn URL: required on every DM and email — recipients verify before replying. PLACEMENT IS YOUR CALL. Common natural placements: bottom-of-signature line ("Dennis McMahon — linkedin.com/in/denniskl"), an aside in the intro ("background here: linkedin.com/in/denniskl"), or a quiet final line beneath the name. NEVER as a parenthetical interrupting the opening sentence — that's the robotic pattern to avoid.
- Intake / CTA URL: required on EVERY step. It is the single low-commitment ask, framed for-their-benefit. On a 300-char connect note, the URL is most of the message. On a longer message, it appears LATE, after the value beat has done its work, on its own line ideally. Never as a bare paste — always introduced ("if something like that comes to mind, this walks you through it: …").
- Proof point from the offering: use when the recipient is in the EXACT vertical the proof addresses, OR when the proof transfers cleanly with one sentence of bridge. Skip when the proof is in a different vertical from the recipient — forcing it signals copy-paste outreach. Better to lead with a vertical-specific observation and let the proof appear only if it actually fits.
- Calendar URL: usually NOT — the intake URL is the lower-commitment ask. Calendar links are for replies, not first-touch outreach.

CONTEXT YOU MUST FACTOR IN

The recipient profile section of your input carries everything we know about this prospect. Read it before writing. Specifically:

- Network distance (1st-degree warm / 2nd-degree lukewarm / cold) — drives tone and whether to use the warm_opener. Skipping this = generic outreach.
- Recipient title — drives what "their problem" looks like. An Operations Director and a Founder have different pains.
- Recipient firm + vertical — drives which proof points fit and which insight earns the read.
- Recent LinkedIn posts (if present) — the strongest signal. If a post is about a specific operational decision they made, reference it. Sparingly.
- Firm news / named deals (if present) — public visible signal you can cite without sounding stalkerish.
- Operator-supplied notes (if present) — operator's ground-truth hand-knowledge of this prospect. Weight heavily.
- Recipient geography — affects language (see Localisation below) and vertical-pain inference.

If any of these are populated, your output should REFLECT that you read them. If only name + title + firm + vertical are present, write vertical-level honestly and don't fake specificity.

VERTICAL ADAPTATION (this matters)

The offering may have a flagship proof in one vertical. DO NOT lead with that proof when the recipient is in a different vertical. For a transport recipient, lead with a transport observation; mention the flagship only if it genuinely transfers and the message has space for it. For a logistics recipient, lead with a logistics observation. The reader hears "they sent the same email to everyone" the moment the proof feels off-vertical.

WHEN YOU HAVE STRONG RECIPIENT SIGNAL

If the recipient profile carries a specific signal (recent post, named operational decision, public quote, firm news), USE IT directly. "Saw your post on factory-to-site handoff" beats "operators in your vertical typically face handoff issues". Quote sparingly; reference often.

WHEN YOU HAVE WEAK SIGNAL

If the only thing you know is name + title + firm + vertical, write the vertical-level pain honestly. Do NOT manufacture specificity ("your work in modular construction is impressive") — readers detect fake specificity instantly. A generic-but-honest message beats a falsely personalised one.

LOCALISATION

If the recipient's geography is non-English-primary (Vietnam, Japan, Korea, China, Thailand, etc.) AND the recipient's recent_posts contain non-English content, write in their language with proper diacritics. Subject can stay English unless the body is fully translated. Report detected_language accurately.

NEVER

- Use placeholder syntax like {first_name} — you receive the resolved values, write them in.
- Vendor jargon: "AI-powered", "synergies", "leverage", "best-in-class", "cutting-edge", "robust", "scalable".
- Big promises: "transform your business", "guaranteed ROI", "10x productivity".
- Pin days: "Does Thursday or Friday work?" — book their calendar via the intake URL or calendar URL, not by suggesting times.
- Write "your firm" as literal text. If you don't know the firm name, reshape the sentence to avoid naming it.
- For Funding mode: compliance-forbidden vocabulary — "tokenisation", "crypto", "RWA", "guaranteed", "risk-free".

CALIBRATION — two cold emails in two different recipient situations

These illustrate the SHAPE you're aiming for — length, where the sender intro sits, where the proof sits (or doesn't), where the CTA sits, the tone of the close. The literal phrases are illustrative and will be different in your output. If your output contains sentences lifted from these examples, you have failed: those exact phrases will then appear across hundreds of unrelated outputs and the recipient will feel the template.

EXAMPLE A — recipient is IN the same vertical as the sender's flagship proof.
The proof has earned its place. Lead with a firm-specific observation (something public the recipient has done / said / shipped), then the proof in one sentence, then a recipient-grounded ask. ~120 words.

Subject: One slow handoff at [Firm]?

Hi [Name],
Saw [Firm] just announced [public signal — e.g. a partnership / certification / opening]. The factory-to-site handoff layer is usually where that kind of growth bites first.
Quick context — I'm [Sender] at [Sender Org]. We shipped an end-to-end platform for an Australian modular operator: Stages 0-5 in 5 weeks vs the 14-week baseline, fixed price.
If a comparable handoff at [Firm] is still half-shipped, this 4-min intake describes what we'd actually build — no call, no commitment:
[INTAKE URL]

Worth a look either way.

[Sender]
linkedin.com/in/[sender]

EXAMPLE B — recipient is in a DIFFERENT vertical from the sender's flagship proof.
The flagship is NOT the lead. Often the right call is to omit the flagship entirely and let the vertical-level observation + intake URL do the work. When the flagship IS mentioned, it's a one-line credibility marker AFTER the recipient-vertical observation has earned the read — never the bridge sentence. ~110 words.

Subject: One slow process at [Firm]?

Hi [Name],
Dispatch scheduling, route optimisation, and compliance logging are usually the three that quietly eat the most fleet-side time — and the tools to fix one of them have crossed the line from "needs a dev team" to "ship in a month".
Quick context — I'm [Sender] at [Sender Org]. We're a small Aus build shop; recent platforms have shipped in 5-week sprints against typical 14-week schedules.
This 4-min intake describes what we'd build for a fleet specifically — no call, no commitment:
[INTAKE URL]

Worth a look either way.

[Sender]
linkedin.com/in/[sender]

CONTRAST — what these two examples teach
- Example A's opener cites the recipient firm specifically; Example B's opener is vertical-level because we have no firm-specific signal. Both lead with the recipient, not the sender.
- Example A names the flagship proof (same vertical = relevant). Example B alludes to "5-week sprints" without naming the modular flagship (different vertical = forcing it would signal copy-paste).
- Both bury the sender intro inside one sentence ("Quick context — I'm…"). Neither leads with "Dennis McMahon here, Director at…" — that pattern is what kills the read.
- Both end with the same single low-commitment CTA shape, but the phrasing varies. Your version should vary again.

WEAK example — what to avoid:

"Hi Kevin — Dennis McMahon here, Director at Corporate AI Solutions (linkedin.com/in/denniskl). We build fixed-price AI tools for operator-led businesses in 4 weeks. Built MMC Build, our flagship modular construction platform (compliance engine, design optimisation, cost estimation). Happy to run a free 2-week pilot on one of your projects. 4-week intake walks through how a build would work: [URL] — Dennis"

Why it's weak: formal intro + LinkedIn URL parenthetical eats the first sentence, "fixed-price AI tools" is buzzword soup, the proof is pitched not earned, the offer ("free pilot") feels generic, and the message reads as templated outreach instead of one human writing to another.

OUTPUT — return ONLY this JSON, no fences, no prose:
{
  "subject": "<email subject ≤60 chars, or null if channel is not 'email'>",
  "body": "<the message body, ready to send>",
  "personalization_score": <1-10 integer — 10 = quotes a specific recipient signal; 5 = honest vertical-level fit; 1 = generic>,
  "detected_language": "<English | Vietnamese | Japanese | etc.>"
}`;

// =============================================================================
// Main entry point
// =============================================================================

export async function writeMessageViaLLM(
  input: LLMRenderInput,
): Promise<LLMRenderResult | LLMRenderError> {
  const userMessage = buildUserMessage(input);

  // Tiered model selection: Sonnet for first-touch (steps 1-3, high
  // signal-density), Haiku for follow-ups (steps 4-6). ~33% LLM-cost
  // saving per campaign month. Master env-var override available for
  // operators who want to force one model globally (e.g. all-Opus for a
  // high-stakes campaign).
  const masterOverride = process.env.RENDER_MODEL_OVERRIDE;
  const model = masterOverride || modelIdForTier(selectModelTier(input.template_key));

  let response;
  try {
    response = await client.messages.create(
      {
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: AbortSignal.timeout(20_000) }, // per-render budget; callers chunk for Vercel ceiling
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, error: `LLM returned no JSON object: ${text.slice(0, 200)}` };
  }

  let parsed: {
    subject?: string | null;
    body?: string;
    personalization_score?: number;
    detected_language?: string;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, error: `LLM returned invalid JSON: ${jsonMatch[0].slice(0, 200)}` };
  }

  if (!parsed.body || parsed.body.trim().length === 0) {
    return { ok: false, error: 'LLM returned empty body' };
  }

  // Honor hard char limits even if the LLM overshot. Truncation is rare with
  // a clear prompt, but the connect-note limit (300) is enforced by LinkedIn
  // — sending over it returns 400. Better to truncate than to ship broken.
  let body = parsed.body.trim();
  if (input.channel === 'linkedin_connect' && body.length > 300) {
    body = body.slice(0, 297).trim() + '...';
  }

  return {
    ok: true,
    subject: input.has_subject ? (parsed.subject || null) : null,
    body,
    personalization_score: clampScore(parsed.personalization_score),
    detected_language: parsed.detected_language?.trim() || 'English',
  };
}

// =============================================================================
// User-message builder
// =============================================================================

function buildUserMessage(input: LLMRenderInput): string {
  const { partner, context, signal } = input;

  // Mode inference — give the LLM a hint but let it confirm.
  const isFundingMode = partner.offering_kind === 'project';
  const modeHint = isFundingMode ? 'FUNDING (investor-hunting)' : 'SALES (buyer-hunting)';

  // Recipient profile section
  const recipientLines: string[] = [
    `First name (use this exact spelling): ${input.first_name}`,
    `Full name: ${partner.contact_name ?? '(unknown)'}`,
    `Title: ${partner.contact_title ?? '(unknown)'}`,
    `Firm name (use this exact spelling — NEVER substitute "your firm"): ${input.firm}`,
    `Network distance: ${partner.profile_connected_at ? '1st-degree LinkedIn (we are connected)' : 'cold / no relationship'}`,
    `Recipient geography: ${partner.offering_context?.recipient_geography ?? '(unknown)'}`,
  ];
  if (partner.profile_engagement_flags?.is_creator) recipientLines.push('LinkedIn creator (active poster)');
  if (partner.profile_shared_connections_count) {
    recipientLines.push(`Shared connections with sender: ${partner.profile_shared_connections_count}`);
  }
  if (partner.audience_overlap_notes) recipientLines.push(`Audience-overlap notes: ${partner.audience_overlap_notes}`);
  if (partner.complementarity_notes) recipientLines.push(`Complementarity notes: ${partner.complementarity_notes}`);
  if (partner.partner_readiness_notes) recipientLines.push(`Partner-readiness notes: ${partner.partner_readiness_notes}`);

  // Recent LinkedIn posts — top 3, trimmed
  if (partner.profile_recent_posts?.length) {
    const posts = partner.profile_recent_posts.slice(0, 3).map((p, i) => {
      const date = p.parsed_datetime ? ` (${p.parsed_datetime.slice(0, 10)})` : '';
      const tag = p.is_repost ? ' [REPOST]' : '';
      return `  ${i + 1}.${tag}${date} ${(p.text || p.repost_content_text || '').slice(0, 280)}`;
    });
    recipientLines.push(`Recent LinkedIn posts:\n${posts.join('\n')}`);
  }

  // Firm-level evidence
  if (partner.firm_recent_news?.length) {
    const items = partner.firm_recent_news.slice(0, 3).map(n => `  - ${n.title}: ${n.snippet.slice(0, 200)}`);
    recipientLines.push(`Recent firm news (Brave):\n${items.join('\n')}`);
  }
  if (partner.firm_named_deals?.length) {
    const items = partner.firm_named_deals.slice(0, 3).map(n => `  - ${n.title}: ${n.snippet.slice(0, 200)}`);
    recipientLines.push(`Named deals / portfolio (Brave):\n${items.join('\n')}`);
  }
  if (partner.operator_notes) {
    recipientLines.push(`Operator-supplied notes (ground truth — weight heavily): ${partner.operator_notes}`);
  }

  // Offering context
  const offering = partner.offering_context;
  const offeringLines: string[] = [];
  if (offering) {
    offeringLines.push(`Name: ${offering.name}`);
    offeringLines.push(`Pitch: ${offering.pitch}`);
    if (offering.sector) offeringLines.push(`Sector: ${offering.sector}`);
    if (offering.geography) offeringLines.push(`Offering geography: ${offering.geography}`);
    if (offering.pitch_deck_url) offeringLines.push(`Pitch deck URL (use as CTA in Funding mode): ${offering.pitch_deck_url}`);
    if (offering.one_pager_url) offeringLines.push(`One-pager / intake URL (use as CTA in Sales mode): ${offering.one_pager_url}`);
  } else {
    offeringLines.push('(no offering context configured — write a generic intro for the sender\'s organisation)');
  }

  // Sender identity
  const senderLines: string[] = [
    `Name: ${context.sender_name}`,
    `Role: ${context.sender_role}`,
  ];
  if (context.sender_linkedin_url) senderLines.push(`LinkedIn URL: ${context.sender_linkedin_url}`);
  if (context.sender_bio_one_liner) senderLines.push(`One-line bio: ${context.sender_bio_one_liner}`);
  if (context.sender_calendar_url) senderLines.push(`Calendar URL (alternate CTA): ${context.sender_calendar_url}`);

  // Signal section — the per-prospect evidence the upstream extractor produced.
  // Don't quote it verbatim; rephrase naturally in the body.
  const signalSection = signal
    ? `\nPER-RECIPIENT EVIDENCE SUMMARY (rephrase naturally — do not quote verbatim):
- Why-you (one-line): ${signal.short}
- Why-you (1-2 sentences): ${signal.lead}
- Why-you (short follow-up form): ${signal.leadShort}
- What-we-offer (one-line): ${signal.valueOfferShort}
- What-we-offer (1-2 sentences): ${signal.valueOfferLead}
- Specificity tier: ${signal.specificity}
`
    : '';

  // Warm opener (1st-degree only)
  const warmSection = input.warm
    ? `\nWARM OPENER (use this exact line or a variant as the first beat after the greeting): ${input.warm_opener}\n`
    : '';

  return `Write ONE outreach message for the step described below.

STEP CONSTRAINTS (mandatory):
- Channel: ${input.channel}
- Max chars (HARD LIMIT): ${input.max_chars}
- Include subject: ${input.has_subject}
- Outreach tier: ${input.outreach_tier} (${input.outreach_tier === 'confident' ? 'direct ask' : input.outreach_tier === 'qualified' ? 'soft hedged ask' : 'explicit "no pressure" hedging'})
- Warm (1st-degree LinkedIn): ${input.warm}
- Template key (position in sequence): ${input.template_key}

INFERRED MODE: ${modeHint}

OFFERING:
${offeringLines.join('\n')}

RECIPIENT:
${recipientLines.join('\n')}
${signalSection}${warmSection}
SENDER:
${senderLines.join('\n')}

Now write the message. Return the JSON shape only.`;
}

// =============================================================================
// Internal helpers
// =============================================================================

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}
