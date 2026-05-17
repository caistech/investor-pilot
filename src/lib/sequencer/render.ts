/**
 * Sequencer message renderer.
 *
 * For each step in a sequence template, build the final outbound message body
 * (and subject, where applicable). Pure-string templates are hard-coded here per
 * docs/sprint-0/06-draft-linkedin-message.md and 07-draft-email-message.md.
 * Variable substitution + one Claude one-shot call per step to extract a
 * specific {credit_signal} from the partner's discovery evidence.
 *
 * Returns a discriminated union — the caller (sequencer cron) decides whether
 * to queue for approval or mark the step as compliance_blocked.
 *
 * Sender identity (Phase A of multi-tenant config layer) lives on the
 * organisations row and is passed in via RenderContext. Callers fetch the
 * organisation once per batch and reuse — never inside the per-partner loop.
 *
 * Templates themselves are still hardcoded here (Phase D will move them).
 */

import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { SEED_TEMPLATES, type SeedTemplate } from './seed-templates';

/**
 * Per-organisation context the renderer needs to fill `{sender_name}` and
 * `{sender_role}` placeholders. Caller (cron / admin re-render route)
 * fetches once per batch and passes through. Keeps render.ts free of any
 * direct DB dependency.
 */
export interface RenderContext {
  sender_name: string;
  sender_role: string;
  signature_block?: string | null;
  /** Sender's LinkedIn URL — included so recipients can verify the sender before clicking through. Trust signal. */
  sender_linkedin_url?: string | null;
  /** One-sentence sender bio for richer WHO-AM-I framing. */
  sender_bio_one_liner?: string | null;
  /** Calendar booking URL — substituted into the ASK-LAST element. */
  sender_calendar_url?: string | null;
}

/**
 * The template content the renderer needs for a single step. Caller
 * extracts from the sequence_templates row's steps[i] JSONB. When the row
 * was seeded prior to Phase D and only carries a template_key reference,
 * caller falls back to SEED_TEMPLATES via resolveStepTemplate().
 */
export interface StepTemplate {
  subject: string | null;
  body: string;
  max_chars: number;
  is_warm: boolean;
}

/**
 * Resolve a step's renderer-ready template content from a DB step row.
 * Prefers the step's own subject/body/max_chars/is_warm (Phase D
 * authoritative shape); falls back to SEED_TEMPLATES[template_key] for
 * rows seeded before Phase D landed.
 *
 * Returns null when the template_key is unknown AND the step carries no
 * inline content — caller surfaces this as `unknown_template`.
 */
export function resolveStepTemplate(step: {
  template_key: string;
  subject?: string | null;
  body?: string | null;
  max_chars?: number | null;
  is_warm?: boolean | null;
}): StepTemplate | null {
  const seed: SeedTemplate | null = SEED_TEMPLATES[step.template_key] ?? null;
  if (!step.body && !seed) return null;
  return {
    subject: step.subject ?? seed?.subject ?? null,
    body: step.body ?? seed?.body ?? '',
    max_chars: step.max_chars ?? seed?.max_chars ?? 2000,
    is_warm: step.is_warm ?? seed?.is_warm ?? false,
  };
}

export interface RenderPartner {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  audience_overlap_notes: string | null;
  complementarity_notes: string | null;
  partner_readiness_notes: string | null;
  weighted_score: number | null;
  // Project-scoped URLs from the Knowledge Base (product_sources where
  // source_type='url' AND project_id matches partner.project_id). Caller
  // fetches and passes them through so renderStep stays pure (no db).
  project_url_refs?: string[];

  // Enrichment evidence — populated by orchestrator at assign-batch time
  // (migration 011 + src/lib/enrichment/). All optional; renderer degrades
  // gracefully when null. See render.ts buildEvidenceBundle() for how this
  // gets formatted into the LLM prompts.
  profile_recent_posts?: Array<{
    text: string;
    parsed_datetime: string | null;
    is_repost: boolean;
    author_name: string | null;
    repost_content_text: string | null;
  }> | null;
  profile_connected_at?: string | null;
  profile_shared_connections_count?: number | null;
  profile_engagement_flags?: { is_creator?: boolean; is_premium?: boolean } | null;
  firm_recent_news?: Array<{ title: string; snippet: string }> | null;
  firm_named_deals?: Array<{ title: string; snippet: string }> | null;
  /**
   * Operator-injected private context — read as ground-truth evidence
   * by the fit-signal extractor. Lets the operator override / augment
   * what Brave + LinkedIn surfaced. Persisted on partners.last_session_notes.
   */
  operator_notes?: string | null;
  /**
   * Whether this partner was discovered for a product (sales path) or a
   * project (fundraising path). Drives the fit-signal extraction prompt:
   * product partners get a credit/partner-readiness framing, project
   * partners get an investor / thesis-match framing. Defaults to 'product'
   * so legacy callers keep the original behaviour.
   */
  offering_kind?: 'product' | 'project';
  /**
   * What we're actually pitching. Lets the fit-signal extractor draw
   * inferential connections between the recipient's context (geography,
   * sector, role) and the offering's value prop — e.g. a Vietnamese
   * investor pitched an English-training EdTech can be hooked on
   * "you've likely seen English barriers limit your portfolio's
   * international ambitions firsthand". Without this, the extractor
   * only sees the recipient and can't reason about WHY they'd care.
   */
  offering_context?: {
    name: string;
    pitch: string;
    sector: string | null;
    geography: string | null;
    /** Recipient firm's country/region — used for cultural inferences. */
    recipient_geography?: string | null;
    /** Public URL to the deck — surfaced as a value-offer attachment. */
    pitch_deck_url?: string | null;
    /** Public URL to the one-pager — cheaper deck alternative. */
    one_pager_url?: string | null;
  };
}

export interface RenderedMessage {
  ok: true;
  subject: string | null;
  body: string;
  evidence_refs: Record<string, unknown>;
  personalization_score: number; // 1-10
  /**
   * Outreach tier derived from partner.weighted_score at render time.
   * Surfaces to the Approvals queue as a badge so the operator can
   * scan tone-appropriate batches before approving. See
   * computeOutreachTier() for the score bands.
   */
  outreach_tier: OutreachTier;
}

/**
 * Score-driven tone tier. Modulates opener hedging + ask directness so
 * lower-confidence prospects get exploratory framing ("not sure if this
 * is even your space, but…") and high-confidence prospects get a direct
 * ask. Avoids the failure mode where MIN_ICP_SCORE silently drops
 * tier-3 prospects we'd already paid to enrich — we send to them, but
 * with appropriate tone.
 *
 * - confident   (score ≥ 7): direct ask, no hedging
 * - qualified   (4 ≤ score < 7): soft hedge in opener + ask
 * - exploratory (score < 4): explicit "not sure / no pressure" framing
 *
 * Null score falls back to qualified — safe middle ground.
 */
export type OutreachTier = 'confident' | 'qualified' | 'exploratory';

export function computeOutreachTier(score: number | null | undefined): OutreachTier {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'qualified';
  if (score >= 7) return 'confident';
  if (score >= 4) return 'qualified';
  return 'exploratory';
}

export interface RenderError {
  ok: false;
  reason: string;
  blocker: 'missing_contact' | 'no_credit_signal' | 'unknown_template' | 'llm_error';
}

export type RenderResult = RenderedMessage | RenderError;

// TEMPLATES const + WARM_TEMPLATE_KEYS Set previously lived here. Phase D moved
// the canonical content into src/lib/sequencer/seed-templates.ts; the renderer
// now takes a `template: StepTemplate` arg, so callers source content from the
// DB sequence_templates row (preferred) or fall back via resolveStepTemplate().

export function isWarmTemplate(key: string): boolean {
  return SEED_TEMPLATES[key]?.is_warm === true;
}

export function templateChannel(key: string): 'linkedin_connect' | 'linkedin_dm' | 'email' | null {
  const seed = SEED_TEMPLATES[key]?.channel;
  if (seed) return seed;
  // Auto-generated sequences (generate-from-product / generate-from-project)
  // use template_keys like auto_connect / auto_dm_first / auto_email_fu1.
  // Their channel is inferable from the key — without this fallback the
  // assign-batch validator rejects every LLM-generated sequence.
  if (key.startsWith('auto_')) {
    if (key.includes('connect')) return 'linkedin_connect';
    if (key.includes('dm')) return 'linkedin_dm';
    if (key.includes('email')) return 'email';
  }
  return null;
}

export async function renderStep(
  templateKey: string,
  partner: RenderPartner,
  context: RenderContext,
  template: StepTemplate,
): Promise<RenderResult> {
  const tpl = template;

  if (!partner.contact_name) {
    return {
      ok: false,
      reason: 'Partner has no contact_name; need first name for {first_name} substitution',
      blocker: 'missing_contact',
    };
  }

  // Detect job-descriptor values masquerading as the contact_name.
  // Happens with LinkedIn search results where the LI 2nd-degree result's
  // "headline" line ("Seed", "Pre-seed", "Advisor", "Founder") got
  // ingested into contact_name instead of an actual person. Without
  // this guard the renderer would happily produce "Hi Seed, …" / "Hi
  // Advisor, …" in cold outreach — embarrassing and amateur. Surfacing
  // it as missing_contact (rather than no_credit_signal) so the operator
  // sees a clear "name needs fixing" message in /approvals.
  const GARBAGE_NAMES = new Set([
    'seed', 'pre-seed', 'preseed', 'series-a', 'series a', 'series-b', 'series b',
    'advisor', 'founder', 'partner', 'investor', 'analyst', 'principal', 'associate',
    'director', 'manager', 'ceo', 'cfo', 'cto', 'coo', 'vp', 'gp', 'lp',
    'angel', 'mentor', 'speaker', 'consultant',
  ]);
  const cleanedFullName = partner.contact_name.trim();
  if (GARBAGE_NAMES.has(cleanedFullName.toLowerCase())) {
    return {
      ok: false,
      reason: `contact_name "${cleanedFullName}" looks like a job title, not a person — re-enrich this partner from /prospects to fix.`,
      blocker: 'missing_contact',
    };
  }

  // Strip honorifics so "Ts. Mohammad Hazani Hassan" → "Mohammad",
  // not "Ts.". Same for Dr., Prof., Mr., Ms., Mrs., Eng., Sr., Jr., etc.
  // Operator flagged 2026-05-17 after a Malaysian MTDC contact's draft
  // opened "Ts. — short note…" — reads as obviously templated by a
  // system that doesn't know the recipient.
  const HONORIFICS = new Set([
    'ts.', 'ts', 'dr.', 'dr', 'prof.', 'prof', 'professor',
    'mr.', 'mr', 'ms.', 'ms', 'mrs.', 'mrs', 'mx.', 'mx',
    'eng.', 'eng', 'engineer', 'sir', 'madam',
  ]);
  // Prefer parenthetical Western name when present:
  // "Dang Quoc Tuan (Thomas)" → "Thomas" beats "Dang", since the
  // recipient has self-presented the Western-friendly version.
  const parenMatch = cleanedFullName.match(/\(([A-Za-z][A-Za-z\-']{1,30})\)/);
  let firstName: string;
  if (parenMatch) {
    firstName = parenMatch[1];
  } else {
    const tokens = cleanedFullName.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && HONORIFICS.has(tokens[i].toLowerCase())) i += 1;
    firstName = tokens[i] || '';
  }
  if (!firstName) {
    return { ok: false, reason: 'contact_name was only honorifics — no actual name found.', blocker: 'missing_contact' };
  }

  const warm = template.is_warm;

  // Cold templates require a specific credit signal — generic openers tank
  // reply rates and the v3 brief explicitly forbids them. Warm templates
  // (1st-degree connections) skip this gate: the existing relationship IS
  // the trust signal, no external evidence needed — but they DO get a
  // per-recipient personalised opener so the message doesn't read like
  // an obvious template.
  let signal: CreditSignal | null = null;
  let warmOpener = 'quick one.'; // fallback if Claude call fails — keeps original cadence
  if (!warm) {
    // Always proceeds — extractor falls back to a humble explicit
    // framing rather than refusing, per the researcher rule. The
    // rendered message's confidence is captured in personalization_score
    // (high for tier-1 specific evidence, low for tier-4 humble).
    signal = await extractCreditSignal(partner);
  } else {
    const opener = await generateWarmOpener(partner);
    if (opener) warmOpener = opener;
  }

  // Format the project URLs as a self-contained block so templates can drop
  // {project_urls_block} on its own line. Empty when no URLs are configured
  // for this partner's project — the surrounding newlines collapse cleanly.
  const urls = (partner.project_url_refs || []).filter(u => u && u.trim());
  const projectUrlsBlock = urls.length === 0
    ? ''
    : `\nProject details: ${urls.join(' · ')}\n`;

  const vars: Record<string, string> = {
    first_name: firstName,
    firm: partner.company_name,
    credit_signal: signal?.short || '',
    credit_signal_lead: signal?.lead || '',
    credit_signal_lead_short: signal?.leadShort || '',
    // "Give before take" — every cold message carries a concrete offer.
    // Templates can opt in by using {value_offer} / {value_offer_lead}.
    // Backward-compat: when a template body doesn't include either
    // placeholder, the renderer auto-injects value_offer_lead before
    // the ask paragraph (see post-substitute injection below).
    value_offer: signal?.valueOfferShort || '',
    value_offer_lead: signal?.valueOfferLead || '',
    warm_opener: warmOpener,
    project_urls_block: projectUrlsBlock,
    sender_name: context.sender_name,
    sender_role: context.sender_role,
    // Courtesy-contract placeholders (migration 025). Empty strings when
    // not configured — substituted blank rather than left as literal
    // {placeholder} text, so a missing calendar URL doesn't surface
    // "<<<{sender_calendar_url}>>>" to the recipient.
    sender_linkedin_url: context.sender_linkedin_url || '',
    sender_bio_one_liner: context.sender_bio_one_liner || '',
    sender_calendar_url: context.sender_calendar_url || '',
    pitch_deck_url: partner.offering_context?.pitch_deck_url || '',
    one_pager_url: partner.offering_context?.one_pager_url || '',
    offering_name: partner.offering_context?.name || '',
  };

  const subject = tpl.subject ? substitute(tpl.subject, vars) : null;
  let body = substitute(tpl.body, vars);
  const isShortConnect = templateKey.includes('connect') || (tpl.max_chars && tpl.max_chars <= 320);

  // Backward-compat injection of the WHO-AM-I (sender introduction) for
  // templates generated before the courtesy-contract validator existed
  // (commit 0b90996+). LingoPure $12M run on 2026-05-17 produced drafts
  // missing sender intro entirely — recipient saw "LingoPure is raising
  // Series A..." without knowing WHO was emailing them. Inject after
  // the first paragraph so it reads as a natural second beat. Skipped
  // on connect-note templates (no char budget) and when the body already
  // mentions the sender by name.
  const hasSenderMention = /\{sender_name\}/.test(tpl.body) || (context.sender_name && body.includes(context.sender_name));
  if (!hasSenderMention && !isShortConnect && context.sender_name) {
    body = injectSenderIntro(body, context);
  }

  // Backward-compat injection of the value offer for templates generated
  // before {value_offer_lead} existed. If the body has no offer placeholder
  // AND we have a value offer to give AND the body is an email or DM
  // (not the ≤300 char LinkedIn connect note where there's no room),
  // inject the offer as its own sentence before the final paragraph.
  const hasOfferPlaceholder = /\{value_offer(?:_lead)?\}/.test(tpl.body);
  if (!hasOfferPlaceholder && signal?.valueOfferLead && !isShortConnect) {
    body = injectValueOffer(body, signal.valueOfferLead);
  }

  // Backward-compat injection of the signature block. The courtesy
  // contract requires every step to close with sender identification —
  // name + role + LinkedIn URL (so recipients can verify the sender
  // before responding). Templates pre-dating strict enforcement
  // routinely ended at the value-offer paragraph with no signature,
  // which reads as anonymous. Skipped on short connect notes (no
  // budget) and when the body already ends with the sender's name.
  // Signature handling has two cases:
  //   1. No signature at all → append the full block (name + role + LinkedIn)
  //   2. Bare "— Sender Name" signature → AUGMENT with role + LinkedIn lines
  //      immediately after the name. This is the common case for
  //      LLM-generated templates that closed with just "— {sender_name}"
  //      — they DO have a signature, just an incomplete one. Previously
  //      the renderer treated case 2 as "already has signature, skip"
  //      and the recipient never saw the LinkedIn URL or role in the
  //      structured closer (only buried in body text). Operator flagged
  //      2026-05-17 — the LinkedIn URL is the trust signal that makes
  //      cold replies safe to send.
  const lastChunk = body.slice(-300);
  const hasName = !!(context.sender_name && lastChunk.includes(context.sender_name));
  const hasLinkedInLine = !!(
    context.sender_linkedin_url && (
      lastChunk.includes(context.sender_linkedin_url) ||
      /\bLinkedIn\s*:/i.test(lastChunk)
    )
  );
  const hasRoleLine = !!(context.sender_role && lastChunk.includes(context.sender_role));
  if (!isShortConnect && context.sender_name) {
    if (!hasName) {
      body = injectSignatureBlock(body, context);
    } else if (!hasLinkedInLine || !hasRoleLine) {
      body = augmentMinimalSignature(body, context, { hasLinkedInLine, hasRoleLine });
    }
  }

  // Tier-aware tone modulation. Qualified + Exploratory tiers wrap the
  // rendered body with hedging language so the recipient sees an
  // appropriate confidence level for the underlying fit score. We
  // skip on short connect notes (no char budget for hedging) and
  // on confident tier (no hedging needed — the message stands).
  const outreachTier = computeOutreachTier(partner.weighted_score);
  if (!isShortConnect && outreachTier !== 'confident') {
    body = injectTierHedging(body, outreachTier, context.sender_name);
  }

  // Localization. If the recipient's geography suggests a non-English
  // primary language, translate the rendered body + subject. Keeps the
  // English original in evidence_refs so the operator can verify in
  // Approvals before sending. Skips translation when the offering's own
  // geography matches the recipient's (both English-speaking, or both
  // same locale) or when target language detection returns null.
  const targetLanguage = detectTargetLanguage(partner.offering_context?.recipient_geography);
  let originalSubject = subject;
  let originalBody = body;
  let finalSubject = subject;
  let finalBody = body;
  if (targetLanguage) {
    try {
      const translated = await translateMessage({
        subject,
        body,
        targetLanguage,
        recipientName: partner.contact_name,
      });
      finalSubject = translated.subject;
      finalBody = translated.body;
    } catch (err) {
      // Translation failed — fall back to English rather than blocking.
      // Operator sees English in Approvals; better than an empty message.
      console.warn(`[render] translation to ${targetLanguage} failed for ${partner.company_name}, sending in English:`, err);
    }
  } else {
    // No translation — clear the "original" markers so evidence_refs
    // doesn't claim a translation happened.
    originalSubject = null;
    originalBody = '';
  }

  // LinkedIn connect notes are hard-capped by LinkedIn at 300 chars. Reject
  // rather than truncate — truncating mid-sentence reads worse than re-rendering
  // with a shorter credit_signal. Check the FINAL (post-translation) body
  // since translations vary in length per language.
  if (tpl.max_chars && finalBody.length > tpl.max_chars) {
    return {
      ok: false,
      reason: `Rendered body ${finalBody.length} chars exceeds max ${tpl.max_chars} for ${templateKey}${targetLanguage ? ` (after translation to ${targetLanguage})` : ''}`,
      blocker: 'no_credit_signal', // operator should re-discover with tighter signal
    };
  }

  return {
    ok: true,
    subject: finalSubject,
    body: finalBody,
    evidence_refs: {
      template_key: templateKey,
      credit_signal: signal?.short || (warm ? 'warm_relationship' : ''),
      signal_specificity: signal?.specificity || (warm ? 'first_degree_connection' : ''),
      partner_score: partner.weighted_score,
      warm,
      target_language: targetLanguage,
      outreach_tier: outreachTier,
      // Keep the English original so the Approvals card can show a
      // "view English original" toggle for operator verification.
      original_subject: originalSubject,
      original_body: originalBody,
    },
    personalization_score: warm
      ? warmPersonalizationScore(partner.weighted_score)
      : personalizationScore(signal!.specificity, partner.weighted_score),
    outreach_tier: outreachTier,
  };
}

/**
 * Wrap a rendered body with tier-appropriate hedging so a low-score
 * prospect doesn't receive a confidently-worded ask. Two insertions:
 *
 * 1. **Opener hedge** — inserted as its own paragraph after the
 *    greeting. Signals "I'm not 100% sure this is your space" up
 *    front so the reader isn't asked to absorb a pitch under false
 *    confidence pretences.
 *
 * 2. **Ask softener** — inserted as its own paragraph before the
 *    signature block (em-dash or "Best,"/"Thanks," marker). Gives
 *    the recipient permission to ignore without offense, which
 *    reduces irritation-driven unsubscribes / replies.
 *
 * Idempotent: re-rendering an already-hedged body won't double-inject
 * (each marker uses a distinctive enough phrase that includes() catches
 * the prior insertion).
 *
 * Skipped on confident tier (caller checks before calling) — those
 * messages stand as written.
 */
function injectTierHedging(body: string, tier: OutreachTier, _senderName: string): string {
  const HEDGE_MARKERS = {
    qualified: 'may be off-base on the precise fit',
    exploratory: 'not sure if this is even in your remit',
  } as const;
  const SOFTENER_MARKERS = {
    qualified: 'no offense taken if the timing or fit is off',
    exploratory: 'feel free to ignore if this is outside your space',
  } as const;

  const hedgeMarker = HEDGE_MARKERS[tier as keyof typeof HEDGE_MARKERS];
  const softenerMarker = SOFTENER_MARKERS[tier as keyof typeof SOFTENER_MARKERS];
  if (!hedgeMarker || !softenerMarker) return body;

  const hedgeSentence = tier === 'exploratory'
    ? `Quick caveat up front — ${hedgeMarker}, so feel free to stop reading here if it's clearly not.`
    : `Quick caveat — I ${hedgeMarker}, but wanted to flag this rather than skip over.`;

  const softenerSentence = tier === 'exploratory'
    ? `Truly ${softenerMarker} — I was hedging on the side of reaching out rather than not.`
    : `If even tangentially relevant, happy to share more — ${softenerMarker}.`;

  let out = body;

  // 1) Inject hedge after greeting if not already present
  if (!out.includes(hedgeMarker)) {
    const trimmed = out.trim();
    const firstBreak = trimmed.indexOf('\n\n');
    if (firstBreak === -1) {
      out = `${hedgeSentence}\n\n${trimmed}`;
    } else {
      const greeting = trimmed.slice(0, firstBreak);
      const rest = trimmed.slice(firstBreak + 2);
      out = `${greeting}\n\n${hedgeSentence}\n\n${rest}`;
    }
  }

  // 2) Inject softener before signature if not already present
  if (!out.includes(softenerMarker)) {
    const trimmed = out.trimEnd();
    const signoffPattern = /\n+(—|Best,|Thanks,|Kind regards|Regards,)/i;
    const match = trimmed.match(signoffPattern);
    if (match && match.index !== undefined) {
      const before = trimmed.slice(0, match.index);
      const after = trimmed.slice(match.index);
      out = `${before}\n\n${softenerSentence}${after}`;
    } else {
      out = `${trimmed}\n\n${softenerSentence}`;
    }
  }

  return out;
}

/**
 * Map a free-text geography / category string ("Vietnam Series A B2B SaaS
 * investor", "Tokyo family office", "Riyadh PIF") to a target locale code.
 * Returns null when no clear non-English target is detected — caller
 * keeps the English rendering.
 *
 * Deliberately conservative: only fires for markets where English is
 * clearly not the dominant business communication language. US/UK/AU/CA/
 * Singapore/HK/India default to English even when geography is mentioned.
 */
function detectTargetLanguage(geography: string | null | undefined): string | null {
  if (!geography) return null;
  const g = geography.toLowerCase();
  // Order matters — most specific regions first.
  const map: Array<[RegExp, string]> = [
    [/\b(vietnam|viet|hanoi|ho chi minh|saigon)\b/, 'Vietnamese'],
    [/\b(korea|seoul|korean)\b/, 'Korean'],
    [/\b(japan|tokyo|osaka|kyoto|japanese)\b/, 'Japanese'],
    [/\b(thai|thailand|bangkok)\b/, 'Thai'],
    [/\b(indonesi|jakarta|bali)\b/, 'Indonesian'],
    [/\b(china|chinese|beijing|shanghai|shenzhen|taiwan|taipei)\b/, 'Simplified Chinese'],
    [/\b(hong kong|hk)\b/, 'Traditional Chinese'],
    [/\b(saudi|riyadh|jeddah|emirat|uae|dubai|abu dhabi|qatar|doha|kuwait|bahrain|oman)\b/, 'Arabic'],
    [/\b(brazil|brasil|sao paulo|rio de janeiro|portuguese)\b/, 'Brazilian Portuguese'],
    [/\b(mexico|mexican|spain|spanish|madrid|barcelona|argent|colomb|chile|santiago|peru|lima)\b/, 'Spanish'],
    [/\b(france|paris|french|monaco|lyon|marseille)\b/, 'French'],
    [/\b(german|germany|berlin|munich|frankfurt|austria|vienna|swiss german)\b/, 'German'],
    [/\b(itali|rome|milan|italian)\b/, 'Italian'],
    [/\b(turkey|turkish|istanbul|ankara)\b/, 'Turkish'],
    [/\b(russia|moscow|russian)\b/, 'Russian'],
  ];
  for (const [pattern, language] of map) {
    if (pattern.test(g)) return language;
  }
  return null;
}

/**
 * Translate a rendered message to the target language using Claude. Keeps
 * tone (professional, founder-to-investor / founder-to-partner) and
 * preserves the offering name, sender name, and any URLs verbatim.
 *
 * Single short Claude call (~5-8s). The renderer already produced the
 * English message — this is post-processing, not regeneration. Bounded
 * by the same 12s AbortSignal pattern as the other render-path calls.
 */
async function translateMessage(args: {
  subject: string | null;
  body: string;
  targetLanguage: string;
  recipientName: string | null;
}): Promise<{ subject: string | null; body: string }> {
  const { subject, body, targetLanguage, recipientName } = args;
  const recipientLine = recipientName ? `Recipient first-name: ${recipientName.trim().split(/\s+/)[0]}` : '';
  const subjectLine = subject ? `SUBJECT (translate):\n${subject}\n\n` : '';
  const prompt = `Translate this business outreach message to natural, professional ${targetLanguage}. ${recipientLine}

Rules:
- Preserve the recipient's first name as written (don't transliterate or change it).
- Preserve proper nouns: company names, sender name, URLs, product names.
- Preserve numbers / dates / dollar amounts as written, but localise currency words if appropriate.
- Match the tone: professional, direct, founder-to-investor / founder-to-partner. Not overly formal.
- DO NOT add greetings, signoffs, or content that isn't in the source.
- DO NOT add commentary about the translation.

${subjectLine}BODY (translate):
${body}

Return ONLY JSON with no prose:
{
  "subject": ${subject ? '"<translated subject>"' : 'null'},
  "body": "<translated body, preserving line breaks>"
}`;

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 2000,
      system: prompt,
      messages: [{ role: 'user', content: `Translate to ${targetLanguage}.` }],
    },
    { signal: AbortSignal.timeout(12_000) },
  );

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Translation LLM returned no JSON object: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    subject: typeof parsed.subject === 'string' ? parsed.subject : subject,
    body: typeof parsed.body === 'string' && parsed.body.trim().length > 0 ? parsed.body : body,
  };
}

// 1st-degree connections start at 8/10 — the relationship covers most of the
// personalization gap. Boost to 10 for high-ICP-fit. Never below 7.
function warmPersonalizationScore(partnerScore: number | null): number {
  const base = 8;
  const bump = partnerScore && partnerScore >= 8 ? 2 : partnerScore && partnerScore >= 6 ? 1 : 0;
  return Math.min(10, base + bump);
}

function substitute(template: string, vars: Record<string, string>): string {
  const raw = template.replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? `{${key}}`);
  return normaliseSubstitutionArtefacts(raw);
}

/**
 * Clean up grammatical artefacts created when standalone-sentence
 * substitution values land inside lead-in scaffolds. Two recurring
 * patterns we strip:
 *
 * 1. **Redundant "Reaching out because" + Capital lead-in.** The LLM's
 *    credit_signal_lead is documented as a 1-2 sentence opener and
 *    routinely produces "Given X...", "Your Y...", "As Z...". When a
 *    template wraps that in "Reaching out because {credit_signal_lead}"
 *    the result reads "Reaching out because Given Meet Ventures' focus
 *    on..." — grammar nonsense. We collapse the redundant lead-in so
 *    the sentence stands cleanly.
 *
 * 2. **Double periods.** Templates that end the line with
 *    "{credit_signal_lead}." get "...barriers.." because the value
 *    already ends in a period. We collapse ".." → ".".
 *
 * Both fixes are conservative: they don't touch URLs (the `..` collapse
 * is gated by a leading word char) and they preserve the original
 * meaning. Run at render time so all existing drafts benefit on next
 * render — no operator template-editing required.
 */
function normaliseSubstitutionArtefacts(text: string): string {
  let out = text;

  // Strip lead-in scaffolds when followed by a capital letter. That
  // capital is the signal that the substituted value is a standalone
  // sentence rather than a lowercase clause — when the substitution
  // gives a clause ("your stated thesis on…"), the lead-in reads fine
  // and we leave it alone.
  const LEAD_IN_PATTERNS: RegExp[] = [
    /\bReaching out because (?=[A-Z])/g,
    /\bI'm reaching out because (?=[A-Z])/g,
    /\bWriting because (?=[A-Z])/g,
  ];
  for (const pat of LEAD_IN_PATTERNS) {
    out = out.replace(pat, '');
  }

  // Collapse double periods that arise from template-ends-in-period +
  // value-ends-in-period. Guarded by leading word char so URLs and
  // ellipses survive.
  out = out.replace(/(\w)\.\.(?!\.)/g, '$1.');

  // Collapse double full-stops separated only by whitespace (less common
  // but happens when value ends with ".\n" and template appends "." on
  // the next line).
  out = out.replace(/(\w)\.\s+\.(?!\.)/g, '$1.');

  return out;
}

/**
 * Inject a value-offer sentence into a rendered body that didn't use the
 * {value_offer_lead} placeholder. Strategy: find the LAST paragraph break
 * before the closing signature, and inject the offer as its own paragraph
 * just before it. So the message ends:
 *
 *   …main pitch and ask…
 *
 *   <VALUE OFFER>
 *
 *   — Sender
 *
 * If we can't identify a signature paragraph, we append to the end before
 * the sign-off. Always idempotent (no double-injection on re-render).
 */
function injectValueOffer(body: string, offerLead: string): string {
  if (body.includes(offerLead.slice(0, 40))) return body; // already injected
  // Look for a sign-off marker — common patterns: "— Name", "Best,", "Thanks,"
  const trimmed = body.trimEnd();
  const signoffPattern = /\n+(—|Best,|Thanks,|Kind regards|Regards,)/i;
  const match = trimmed.match(signoffPattern);
  if (match && match.index !== undefined) {
    const before = trimmed.slice(0, match.index);
    const after = trimmed.slice(match.index);
    return `${before}\n\n${offerLead}${after}`;
  }
  // No clear signature — append before the final newline.
  return `${trimmed}\n\n${offerLead}`;
}

/**
 * Backward-compat injection of the sender introduction for templates that
 * don't include {sender_name} anywhere in the body. The courtesy contract
 * requires every step (except short connect notes) to identify the
 * sender — anonymous senders get archived by busy recipients.
 *
 * Injects after the first paragraph break so it reads as the natural
 * second beat: greeting → who I am → why I'm reaching out. Uses
 * sender_bio_one_liner if available for a richer who-am-I framing,
 * falls back to sender_name + sender_role.
 *
 * Always idempotent — won't double-inject if the body already mentions
 * the sender by name (caller checks this before calling).
 */
function injectSenderIntro(body: string, context: RenderContext): string {
  const intro = context.sender_bio_one_liner
    ? `I'm ${context.sender_name} — ${context.sender_bio_one_liner}.`
    : `I'm ${context.sender_name}, ${context.sender_role}.`;
  // Find the first paragraph break — typically right after the greeting
  // ("Hi Jane,\n\n..." or "{first_name},\n\n..."). Inject the intro as
  // its own paragraph immediately after.
  const trimmed = body.trim();
  const firstBreak = trimmed.indexOf('\n\n');
  if (firstBreak === -1) {
    // No paragraph structure — prepend with a separator so the intro
    // doesn't smash into the existing body.
    return `${intro}\n\n${trimmed}`;
  }
  const greeting = trimmed.slice(0, firstBreak);
  const rest = trimmed.slice(firstBreak + 2);
  return `${greeting}\n\n${intro}\n\n${rest}`;
}

/**
 * Backward-compat injection of a signature block. Constructs the closing
 * lines from the sender context: name + role + LinkedIn URL (so the
 * recipient can verify the sender in one click) + optional signature
 * block from /settings if the operator has filled it in.
 *
 * The em-dash separator is the conventional cold-outreach closing
 * cue. Format:
 *
 *   — Dennis McMahon
 *   Technical Director, Corporate AI Solutions
 *   LinkedIn: https://www.linkedin.com/in/dennis-mcmahon
 *   [signature_block lines if set]
 *
 * Idempotent — caller checks the body doesn't already contain the
 * sender's name in the last 200 chars before calling.
 */
function injectSignatureBlock(body: string, context: RenderContext): string {
  const lines: string[] = [`— ${context.sender_name}`];
  if (context.sender_role) lines.push(context.sender_role);
  if (context.sender_linkedin_url) lines.push(`LinkedIn: ${context.sender_linkedin_url}`);
  if (context.signature_block) {
    // signature_block may itself span multiple lines (org name, phone,
    // website). Dedupe against lines we've already added so e.g. an
    // operator with sender_role="Technical Director" AND
    // signature_block="Technical Director\nLingoPure" doesn't get
    // "Technical Director" appearing twice. Compare case-insensitively
    // and trimmed — operator's hand-typed signature_block doesn't
    // always match casing/whitespace of the atomic sender_role.
    const existing = new Set(lines.map((l) => l.trim().toLowerCase()));
    const sigLines = context.signature_block.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const sigLine of sigLines) {
      if (!existing.has(sigLine.toLowerCase())) {
        lines.push(sigLine);
        existing.add(sigLine.toLowerCase());
      }
    }
  }
  return `${body.trimEnd()}\n\n${lines.join('\n')}`;
}

/**
 * Augment a bare "— Sender Name" signature with role + LinkedIn lines.
 * Used when the template body already includes the sender name in its
 * closer (so injectSignatureBlock would skip), but the structured
 * signature lines (role + verifiable LinkedIn URL) are missing — those
 * are the trust signals that make cold replies safe to send.
 *
 * Finds the LAST occurrence of the sender's name in the body and
 * inserts the missing lines on the next line break. Idempotent:
 * caller has already checked which lines are missing and passes only
 * those flags.
 *
 * Edge case: when the sender name appears MULTIPLE times in the body
 * (e.g. once in the sender intro, once in the closer), we target the
 * LAST occurrence — that's the signature, not the intro.
 */
function augmentMinimalSignature(
  body: string,
  context: RenderContext,
  flags: { hasLinkedInLine: boolean; hasRoleLine: boolean },
): string {
  const additions: string[] = [];
  if (!flags.hasRoleLine && context.sender_role) {
    additions.push(context.sender_role);
  }
  if (!flags.hasLinkedInLine && context.sender_linkedin_url) {
    additions.push(`LinkedIn: ${context.sender_linkedin_url}`);
  }
  if (additions.length === 0) return body;

  // Find the LAST occurrence of the sender name — that's the closer,
  // not the intro mention.
  const trimmed = body.trimEnd();
  const nameIdx = trimmed.lastIndexOf(context.sender_name);
  if (nameIdx === -1) return body; // shouldn't happen — caller checked hasName

  // Find the end of the line containing the name. Insert the new lines
  // right after it so they sit immediately under "— Sender Name".
  const lineEnd = trimmed.indexOf('\n', nameIdx);
  if (lineEnd === -1) {
    // Name is on the last line with no trailing newline — append after.
    return `${trimmed}\n${additions.join('\n')}`;
  }
  const before = trimmed.slice(0, lineEnd);
  const after = trimmed.slice(lineEnd);
  return `${before}\n${additions.join('\n')}${after}`;
}

interface CreditSignal {
  ok: true;
  short: string;       // ≤ 80 chars, slots into "{credit_signal} suggests fit"
  lead: string;        // ~1-2 sentences, opener for first email
  leadShort: string;   // ~1 sentence, opener for follow-up email
  /**
   * The value WE offer THEM, before asking for anything. Researcher
   * principle: every cold outreach should give something — a free trial,
   * a useful brief, an intro, a research summary — so we read as offerers
   * not askers. Specific to the recipient where possible.
   * - valueOfferShort: ≤ 80 chars chip that slots into "{value_offer} —"
   * - valueOfferLead:  ~1-2 sentences for first email
   */
  valueOfferShort: string;
  valueOfferLead: string;
  /**
   * Tier of grounding for the message. Drives personalization_score +
   * (in future) per-tier template language. Never returns failure — the
   * researcher rule: we always reach out, even if all we have is the
   * firm name and sector.
   *
   * - specific_deal:   named portfolio company / quoted credit deal (tier 1)
   * - sector_evidence: stated thesis / sector position / firm news (tier 2)
   * - sector_anchor:   no per-firm evidence — anchored on sector + geography
   *                    of the recipient pool we surfaced them from (tier 3)
   * - humble_intro:    no evidence at all — explicit "we found you, here's
   *                    why we thought you might be interested" (tier 4)
   */
  specificity: 'specific_deal' | 'sector_evidence' | 'sector_anchor' | 'humble_intro';
}

async function extractCreditSignal(partner: RenderPartner): Promise<CreditSignal> {
  // Evidence priority (high → low):
  //   1. Recent LinkedIn posts (real human voice, dated, specific)
  //   2. Brave firm-enrichment (named deals, recent news — credit signal direct)
  //   3. Scoring-time notes (inference from initial SERP)
  //
  // We pass all three to the LLM in this order so the model can pick the
  // strongest signal. Without enrichment (legacy rows) the prompt degrades
  // gracefully to scoring notes alone — same behaviour as pre-migration 011.
  const evidenceParts: string[] = [];

  const usablePosts = (partner.profile_recent_posts || []).filter(p => {
    const txt = (p.text || p.repost_content_text || '').trim();
    return txt.length >= 40;
  }).slice(0, 3);
  if (usablePosts.length > 0) {
    evidenceParts.push('LINKEDIN POSTS (recent, most credit-relevant first):');
    usablePosts.forEach((p, i) => {
      const txt = (p.is_repost && p.repost_content_text ? p.repost_content_text : p.text).slice(0, 500);
      const when = p.parsed_datetime ? new Date(p.parsed_datetime).toISOString().slice(0, 10) : '?';
      evidenceParts.push(`  [${when}, ${p.is_repost ? 'repost' : 'own'}] ${txt}`);
    });
  }

  const firmNews = partner.firm_recent_news || [];
  const firmDeals = partner.firm_named_deals || [];
  if (firmDeals.length > 0) {
    evidenceParts.push('FIRM NAMED DEALS (Brave search — credit-signal evidence):');
    firmDeals.slice(0, 3).forEach(d => evidenceParts.push(`  - ${d.title}: ${d.snippet}`));
  }
  if (firmNews.length > 0) {
    evidenceParts.push('FIRM RECENT NEWS (Brave search):');
    firmNews.slice(0, 3).forEach(d => evidenceParts.push(`  - ${d.title}: ${d.snippet}`));
  }

  // Operator-injected note FIRST — this is ground truth from someone
  // who actually knows the prospect. The extractor's prompt is told to
  // weight this above auto-collected evidence. A 2-line note like
  // "met them at SaaStr, actively scouting SEA EdTech under $5M" is
  // worth more than 100 lines of generic Brave news.
  if (partner.operator_notes && partner.operator_notes.trim()) {
    evidenceParts.push('OPERATOR NOTE (ground truth — weight above public evidence):');
    evidenceParts.push(partner.operator_notes.trim().slice(0, 2000));
  }

  const scoringNotes = [
    partner.audience_overlap_notes,
    partner.complementarity_notes,
    partner.partner_readiness_notes,
  ].filter(Boolean).join('\n');
  if (scoringNotes) {
    evidenceParts.push('SCORING NOTES (initial classifier — secondary):');
    evidenceParts.push(scoringNotes);
  }

  const evidence = evidenceParts.join('\n');

  // Researcher rule: if we have nothing public to anchor on, we still
  // reach out — humbly and explicitly. The operator's boss expects 35
  // candidates, not 18; refusing the thin-evidence ones leaves money on
  // the table. The message must be honest about its basis ("we found
  // you among SEA Series A investors and thought…") rather than
  // confabulating a deal that doesn't exist.
  if (!evidence.trim()) {
    return buildHumbleFallback(partner);
  }

  // Switch the extraction prompt based on whether the partner was
  // discovered for a product (sales partner) or a project (investor).
  // Same JSON shape both sides — the renderer substitutes the result
  // into {credit_signal} / {credit_signal_lead} / {credit_signal_lead_short}
  // placeholders. Only the LLM's framing changes.
  const kind = partner.offering_kind ?? 'product';
  const recipientNoun = kind === 'project' ? 'investor / capital allocator' : 'partner';

  // What we're pitching — fed to the LLM so it can REASON about why this
  // specific recipient might care, not just regurgitate evidence facts.
  // A Vietnamese investor pitched English-training EdTech doesn't need a
  // "named deal" hook to be interested — they likely have personal
  // experience with the problem. The model can draw that inference if
  // we give it the offering context.
  const offering = partner.offering_context;
  const offeringSection = offering
    ? `\nWHAT WE'RE PITCHING TO THEM:
- Name: ${offering.name}
- Pitch: ${offering.pitch}
- Sector: ${offering.sector ?? '(unspecified)'}
- Geography of the offering: ${offering.geography ?? '(unspecified)'}
- Recipient's geography (helps with cultural / market inferences): ${offering.recipient_geography ?? '(unspecified)'}
`
    : '';

  const prompt = `You're a senior research analyst preparing personalised cold outreach to a ${recipientNoun}. Two outputs are required: (a) a personalised fit angle, and (b) a concrete value offer FROM US TO THEM, before we ask for anything. We must read as offerers, not takers.

INFORMATION SOURCES

1. EVIDENCE about ${partner.company_name} (what we found via Brave / LinkedIn / discovery scoring):
${evidence}
${offeringSection}

PART A — FIT ANGLE
THINK LIKE A HUMAN RESEARCHER, NOT A TEMPLATE-FILLER. Examples of legitimate angles:
- Named investment / named deal that fits the offering's sector  → strongest (tier 1)
- Recipient's stated thesis matches the offering's market         → strong (tier 2)
- Recipient's geography / culture / language suggests personal interest in the problem
  (e.g. "as a Vietnamese investor you've likely seen first-hand how English
   communication barriers limit portfolio companies' international ambitions" —
   LEGITIMATE inference from geography + offering sector, not fabrication) → tier 2 / 3
- Sector overlap without specifics ("SEA Series A investors broadly")     → tier 3
- Nothing specific — humble explicit reach-out                            → tier 4

Rules:
- Never fabricate specifics (don't invent deals, don't quote things they haven't said).
- Inferences from geography / sector / role are allowed if hedged ("likely…", "given your stated focus…").
- For non-English-speaking markets (Vietnam, Korea, Japan, China, MENA, LATAM, Iberia, France, Germany etc.) consider whether language / cultural friction with English-first products is the angle.

PART B — VALUE OFFER (the "give before asking" rule)
EVERY outreach must offer something specific to THIS recipient before asking for a meeting. Brainstorm what we can plausibly give them based on what we are (the offering) and what they do (their firm / portfolio / thesis). Examples:
- For an INVESTOR pitched a product/raise:
    • "free pilot of <product> for one of your portfolio companies hitting this problem"
    • "happy to send our <sector> market brief — useful for diligence even if not a fit"
    • "intros to other founders we know in your portfolio's adjacent space"
    • "I can share the cap-table + LP composition of our last round, useful comp"
- For a CHANNEL PARTNER pitched a product:
    • "free pilot for your top customer in <sector>"
    • "co-marketing post on our channel"
    • "referral commission structure write-up"
- For a DIRECT LENDER pitched a debt facility:
    • "credit memo + LVR sensitivity model upfront, no NDA"
    • "warm intro to the developer's bank reference"
- For a LP / family office pitched a fund:
    • "track-record one-pager + co-investor list"
    • "share our DDQ template"

Pick the offer that's MOST RELEVANT to this specific recipient. If they appear to be a Vietnam investor and we're pitching an EdTech English platform, "free pilot for a portfolio company hitting English-scaling friction" is excellent. If they're a credit allocator, "credit memo + LVR sensitivity" is excellent. Don't generic-offer; tailor.

Return ONLY JSON, no prose:
{
  "short": "<≤80 chars fit-angle phrase that slots into 'X suggests fit'>",
  "lead": "<1-2 sentence opener for a cold email — the fit angle, hedged appropriately>",
  "leadShort": "<single sentence opener for a follow-up email>",
  "valueOfferShort": "<≤80 chars chip describing the value we offer, e.g. 'free 3-month LingoPure pilot for one Vietnam portfolio co'>",
  "valueOfferLead": "<1-2 sentences offering it concretely — e.g. 'Happy to set up a free 3-month pilot for any portfolio company hitting English-language scaling friction — no commitment beyond seeing if it moves the needle.'>",
  "specificity": "specific_deal | sector_evidence | generic"
}

If you genuinely cannot find ANY plausible angle (rare), return specificity="generic" and the system will substitute a humble explicit framing. STILL return a valueOffer — there's always something we can give.`;

  try {
    // Hard 12s per-call timeout. Without this, a hung OpenRouter request
    // blocks the parallel Promise.all in runner.ts and the whole render-now
    // route times out at Vercel's 60s ceiling — the operator sees
    // FUNCTION_INVOCATION_TIMEOUT with no useful information. 12s is
    // comfortable for the smallest Claude completion (~400 tokens) while
    // still letting 4 concurrent renders finish well inside 60s.
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 400,
        system: prompt,
        messages: [{ role: 'user', content: 'Extract the credit signal.' }],
      },
      { signal: AbortSignal.timeout(12_000) },
    );

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // LLM returned prose / refused / malformed — fall back rather than block.
      console.warn(`[render] extractCreditSignal got non-JSON response for ${partner.company_name}, using humble framing`);
      return buildHumbleFallback(partner);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    // Researcher rule: never refuse. If the LLM judged its own output
    // generic, fall back to the humble explicit framing rather than
    // blocking the partner. Operator can edit / skip in Approvals.
    if (parsed.specificity === 'generic' || !parsed.short || !parsed.lead) {
      return buildHumbleFallback(partner);
    }

    // If the LLM forgot the value offer, build a basic one from the
    // offering itself so the "give before take" rule still holds.
    const offering = partner.offering_context;
    const fallbackOfferShort = offering ? `brief on ${offering.name}` : 'useful resource share';
    const fallbackOfferLead = offering
      ? `Happy to share a one-pager on ${offering.name} (sector / traction / terms) ahead of any call — useful for context even if it's not a fit right now.`
      : 'Happy to share a brief one-pager ahead of any call — useful for context even if it isn\'t a fit right now.';

    return {
      ok: true,
      short: String(parsed.short || '').trim(),
      lead: String(parsed.lead || '').trim(),
      leadShort: String(parsed.leadShort || '').trim(),
      valueOfferShort: String(parsed.valueOfferShort || fallbackOfferShort).trim(),
      valueOfferLead: String(parsed.valueOfferLead || fallbackOfferLead).trim(),
      specificity: parsed.specificity === 'specific_deal' ? 'specific_deal' : 'sector_evidence',
    };
  } catch (err) {
    // LLM call failed (timeout, network, parse error). Same researcher
    // rule applies — don't refuse the partner, fall back to a humble
    // grounded message and let the operator decide. The original error
    // is logged via the caller's audit_events path.
    console.warn(`[render] extractCreditSignal LLM failed for ${partner.company_name}, falling back to humble framing:`, err);
    return buildHumbleFallback(partner);
  }
}

/**
 * Humble fallback signal — used when public evidence is too thin to
 * cite a specific deal or sector position. Constructs an explicit
 * "we found you because…" framing using only the facts we know for
 * certain: company name, sector category, geography, and the network
 * distance that surfaced them.
 *
 * Never throws, never returns ok:false. This is the researcher's
 * "boss says reach out anyway, you never know" path.
 */
function buildHumbleFallback(partner: RenderPartner): CreditSignal {
  const firm = partner.company_name || 'your firm';
  const kind = partner.offering_kind ?? 'product';
  // Pull a category hint if available — even the partner_readiness_notes
  // string often mentions a sector ("Vietnam Series A B2B SaaS investor"
  // for ESP Capital, etc).
  const sectorHint = (
    partner.audience_overlap_notes ||
    partner.complementarity_notes ||
    partner.partner_readiness_notes ||
    ''
  ).trim().slice(0, 160);

  // If we know the offering's sector + the recipient's geography, draw a
  // light cultural / market-fit inference. For non-English-speaking
  // markets pitched English-product, the "you've likely experienced this
  // problem firsthand" framing is honest and effective. We hedge with
  // "may" / "perhaps" so the reader doesn't feel a fact has been invented.
  const offering = partner.offering_context;
  const geo = offering?.recipient_geography?.toLowerCase() || '';
  const isNonEnglishMarket = /\b(vietnam|viet|korea|japan|china|thai|indo|saudi|emirat|brazil|mexico|spain|france|german|argent|colomb|chile|tur)/i.test(geo);
  const isEnglishLanguageOffering = !!offering?.pitch && /\b(english|esl|cefr|toefl|ielts|language[\s-]learn|communication)\b/i.test(offering.pitch + ' ' + (offering.sector || ''));

  let inferenceClause: string | null = null;
  if (offering && isNonEnglishMarket && isEnglishLanguageOffering) {
    inferenceClause = `as an investor in a non-English-speaking market you've likely seen first-hand how English communication barriers limit portfolio companies' international ambitions`;
  } else if (offering && offering.sector && sectorHint) {
    inferenceClause = `${sectorHint.replace(/[.\n]+$/, '')} suggests a plausible thesis overlap with ${offering.name} (${offering.sector})`;
  }

  const sectorClause = inferenceClause
    || (sectorHint ? `your profile as a ${sectorHint.replace(/[.\n]+$/, '')}` : null)
    || (kind === 'project' ? `your firm's stated investor focus` : `your firm's stated partner focus`);

  const short = inferenceClause
    ? inferenceClause.slice(0, 80)
    : sectorHint
      ? `${sectorClause} suggests this may be of interest`
      : `we identified ${firm} among our shortlist of plausible fits`;

  const lead = kind === 'project'
    ? `${firm} came up in our shortlist for this raise — we don't have public evidence of a recent fit-specific investment, but ${sectorClause}. Worth a brief intro rather than skipping over.`
    : `${firm} came up in our shortlist of potential partners — we don't have a specific recent collaboration on record, but ${sectorClause}. Worth attempting an intro rather than skipping over.`;

  const leadShort = `${firm} was on our shortlist on the basis of ${sectorClause}; flagging again in case the timing is better now.`;

  // Inference-bearing fallback is tier 3 (anchored), pure hedge is tier 4.
  const tier: CreditSignal['specificity'] = inferenceClause
    ? 'sector_anchor'
    : sectorHint
      ? 'sector_anchor'
      : 'humble_intro';

  // Value offer — always include something. For project (investor)
  // outreach the safest bet is a usable resource: market brief, deck,
  // intro. For product (sales partner) outreach a pilot / trial is
  // the natural give. Tailor where we can with the offering name.
  const offerName = offering?.name || (kind === 'project' ? 'this raise' : 'the platform');
  const valueOfferShort = kind === 'project'
    ? `one-pager on ${offerName} (no NDA, useful comp regardless)`
    : `free pilot of ${offerName} for your team or one customer`;
  const valueOfferLead = kind === 'project'
    ? `Happy to send a one-pager on ${offerName} (sector, traction, terms) ahead of any conversation — useful as a market comp even if it's not a fit for ${firm} right now.`
    : `Happy to set up a free pilot of ${offerName} for ${firm} or one of your top customers — no commitment beyond seeing whether it actually moves the needle.`;

  return {
    ok: true,
    short,
    lead,
    leadShort,
    valueOfferShort,
    valueOfferLead,
    specificity: tier,
  };
}

/**
 * Generate a one-sentence personalised opener for a warm DM. Uses the
 * partner's role + company + headline to produce something that reads
 * like a real person noticing what they do, not a templated mailmerge.
 *
 * Returns null on any failure so the caller can fall back to the
 * default cadence ('quick one.') and not block the send.
 */
async function generateWarmOpener(partner: RenderPartner): Promise<string | null> {
  // Build evidence in priority order: recent posts (highest signal — real
  // human voice) → connection metadata (warm relationship cue) → role/firm
  // (fallback). The LLM is instructed to pick the strongest available
  // anchor; ordering here biases its choice toward post references when
  // available since those generate the most personalised openers.
  const evidenceBits: string[] = [];

  // Recent posts — top 2 most relevant. Use post text or repost text,
  // whichever is non-empty. Limit length to keep the prompt tight.
  const posts = partner.profile_recent_posts || [];
  const usablePosts = posts.filter(p => {
    const txt = (p.text || p.repost_content_text || '').trim();
    return txt.length >= 40;
  }).slice(0, 2);
  if (usablePosts.length > 0) {
    evidenceBits.push('Recent LinkedIn posts (most recent first — REFERENCE THESE PREFERENTIALLY):');
    usablePosts.forEach((p, i) => {
      const effectiveText = (p.is_repost && p.repost_content_text)
        ? p.repost_content_text
        : p.text;
      const trimmed = effectiveText.trim().slice(0, 400);
      const kind = p.is_repost ? `reposted from ${p.author_name || 'someone'}` : 'posted themselves';
      const when = p.parsed_datetime ? formatRelativeDate(new Date(p.parsed_datetime)) : 'recently';
      evidenceBits.push(`  Post ${i + 1} (${kind}, ${when}): "${trimmed}"`);
    });
  }

  // Connection metadata — useful even without posts.
  if (partner.profile_connected_at) {
    const connectedDate = new Date(partner.profile_connected_at);
    const years = (Date.now() - connectedDate.getTime()) / (365 * 24 * 60 * 60 * 1000);
    if (years >= 0.5) {
      evidenceBits.push(`Connected ${years >= 1 ? Math.floor(years) + ' years' : 'months'} ago`);
    }
  }
  if (partner.profile_shared_connections_count && partner.profile_shared_connections_count >= 5) {
    evidenceBits.push(`Mutual connections: ${partner.profile_shared_connections_count}`);
  }

  // Role / firm — fallback when posts aren't available.
  if (partner.contact_title) evidenceBits.push(`Role/headline: ${partner.contact_title}`);
  if (partner.company_name) evidenceBits.push(`Current company: ${partner.company_name}`);
  if (partner.audience_overlap_notes) evidenceBits.push(`Audience/ticket fit notes: ${partner.audience_overlap_notes}`);
  if (partner.complementarity_notes) evidenceBits.push(`Asset class notes: ${partner.complementarity_notes}`);

  if (evidenceBits.length === 0) return null;

  const prompt = `You write conversational warm-DM openers for outreach to existing 1st-degree LinkedIn connections.

Recipient evidence:
${evidenceBits.join('\n')}

Generate a ONE-SENTENCE opener that:
- PREFER referencing a specific recent post (if any provided). Quote a concrete detail — what they posted about, what they reposted — not just "saw your post". E.g. "saw your repost of the Versowood glulam project — adjacent to what F2K's running in TAS".
- If no usable post evidence, reference role/company/connection-time instead.
- Reads natural and brief — like one founder texting another, not a sales template.
- Leads into a pitch about senior debt placement for AU property development.
- Avoids cliches: NO "I hope this finds you well", NO generic "saw your background", NO "exciting opportunity".
- Length: 8-25 words. Single sentence. (Slightly longer allowance when quoting a post.)
- Lower case after a comma is fine. Em dashes fine.
- Do not include the recipient's first name (that's added separately).
- Do not include emojis or hype words.
- If post quoted, paraphrase concretely — don't say "your post about X" without naming the X.

Return ONLY a JSON object, no prose, no markdown:
{
  "opener": "<the one-sentence opener>"
}

If the evidence is too thin to anchor on something specific, return:
{
  "opener": "quick one."
}
That's the safe fallback — keeps the template's original cadence.`;

  try {
    // Same 12s per-call timeout as extractCreditSignal — without this a
    // hung warm-opener call blocks the parallel render and the whole
    // route times out at Vercel's 60s ceiling.
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 200,
        system: prompt,
        messages: [{ role: 'user', content: 'Generate the opener.' }],
      },
      { signal: AbortSignal.timeout(12_000) },
    );

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const opener = typeof parsed.opener === 'string' ? parsed.opener.trim() : '';
    if (!opener) return null;

    // Hard length guard — if Claude went long, fall back rather than ship
    // a paragraph-as-opener that breaks the warm cadence.
    if (opener.length > 200) return null;

    return opener;
  } catch {
    return null;
  }
}

/**
 * Format a date as a relative phrase suitable for inclusion in a warm-DM
 * opener prompt. Used to let the LLM say "last week", "two months ago"
 * etc. instead of bare timestamps. Kept simple — anything beyond a year
 * is treated as just "a while back" since precise old dates rarely add
 * value to outreach openers.
 */
function formatRelativeDate(date: Date): string {
  const days = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
  if (days < 7) return 'last week';
  if (days < 30) return 'a few weeks ago';
  if (days < 90) return `${Math.floor(days / 30)} months ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return 'a while back';
}

function personalizationScore(
  specificity: 'specific_deal' | 'sector_evidence' | 'sector_anchor' | 'humble_intro',
  partnerScore: number | null,
): number {
  // Per-tier base. Operator can read this score and prefer the high-tier
  // drafts in their approvals queue, while the low-tier drafts are still
  // SENT (researcher rule) — they just signal "go light, no specifics
  // available" to the reader.
  const base = (
    specificity === 'specific_deal'   ? 9 :
    specificity === 'sector_evidence' ? 6 :
    specificity === 'sector_anchor'   ? 4 :
                                        2   // humble_intro
  );
  const bump = partnerScore && partnerScore >= 8 ? 1 : 0;
  return Math.min(10, base + bump);
}
