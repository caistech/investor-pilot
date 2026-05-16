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
}

export interface RenderedMessage {
  ok: true;
  subject: string | null;
  body: string;
  evidence_refs: Record<string, unknown>;
  personalization_score: number; // 1-10
}

export interface RenderError {
  ok: false;
  reason: string;
  blocker: 'missing_contact' | 'no_credit_signal' | 'unknown_template' | 'llm_error';
}

export type RenderResult = RenderedMessage | RenderError;

const TEMPLATES = {
  lender_v3_connect: {
    channel: 'linkedin_connect' as const,
    subject: null,
    body: `{first_name} — F2K is placing two AU property dev senior debt facilities directly with selected lenders. {credit_signal} suggests fit. Wholesale, first-mortgage, $1-5M tickets. Open to a brief conversation? — {sender_name}`,
    max_chars: 300,
  },
  lender_v3_dm_first: {
    channel: 'linkedin_dm' as const,
    subject: null,
    body: `Thanks for connecting, {first_name}.

Short context: F2K (factory2key.com.au) is placing senior debt directly into two Australian property development projects, replacing a stalled broker process. Both facilities are first-mortgage, wholesale, fixed-term.

  ▸ Branscombe Estate (Claremont TAS) — $16.2M senior construction. 37 modular dwellings. Indicative 8.5% p.a. + standard fees. ~22mo term. 40% anchor offtake to Homes Tasmania (CHP route).

  ▸ Seafields Estate (Geraldton WA) — $2.5M senior land. 141 residential lots, tri-party Cooperation Agreement signed. Indicative 8.0% p.a. capitalised. Day-1 LVR 71%, dropping to 24% within 6 months at developer's cost.

Open to either facility individually or combined. Lenders pari-passu in syndicate.

If a 20-minute credit conversation is useful, I can share the V10 Finance Submissions and project models. {credit_signal} suggested fit. If not relevant, completely understand.
{project_urls_block}
— {sender_name}
{sender_role}`,
    max_chars: 2000, // LinkedIn DM ~8k char limit, we cap shorter
  },
  lender_v3_email_first: {
    channel: 'email' as const,
    subject: `{first_name} — F2K $18.7M AU property senior debt, direct lender process`,
    body: `Hi {first_name},

{credit_signal_lead}

F2K is placing $18.7M senior debt directly with selected lenders across two Australian property development projects:

  • Branscombe Estate (Claremont, TAS) — $16.2M senior construction, 8.5% p.a. indicative + standard fees, ~22 months, first-mortgage. 37 modular dwellings, 40% anchor offtake to Homes Tasmania.

  • Seafields Estate (Geraldton, WA) — $2.5M senior land, 8.0% p.a. capitalised, ~36 months, first-mortgage over 141 residential lots. Signed tri-party Cooperation Agreement (Mar 2026). Day-1 LVR 71% dropping to 24% within six months.

Both pari-passu, wholesale, fixed-term. Lenders can take either facility individually or both. Typical ticket band $1-5M.

V10 Finance Submissions and project models available on request. If a 20-minute credit conversation is useful, reply here and I'll send a calendar link.
{project_urls_block}
— {sender_name}
{sender_role}`,
    max_chars: 2500,
  },
  lender_v3_email_fu1: {
    channel: 'email' as const,
    subject: `Re: {first_name} — F2K $18.7M AU property senior debt`,
    body: `Hi {first_name},

Quick follow-up on the F2K senior debt position. {credit_signal_lead_short}

If a 20-minute credit conversation on either facility (Branscombe $16.2M senior construction TAS / Seafields $2.5M senior land WA, both first-mortgage, 8-8.5% indicative) would be useful, I can share the V10 Finance Submissions and project models.

If not the right moment or not a fit, no further follow-up needed.

— {sender_name}
F2K Capital`,
    max_chars: 1200,
  },
  lender_v3_dm_fu: {
    channel: 'linkedin_dm' as const,
    subject: null,
    body: `{first_name} — short follow-up. If a 20-min call on either of the F2K facilities (Branscombe $16.2M senior construction, Seafields $2.5M senior land, both first-mortgage, 8-8.5% indicative) would be useful, I can share V10 IMs and credit models. Otherwise no further follow-up.

— {sender_name}`,
    max_chars: 600,
  },
  lender_v3_email_fu2: {
    channel: 'email' as const,
    subject: `Closing the loop — F2K senior debt`,
    body: `Hi {first_name},

Closing the loop on the F2K $18.7M senior debt position. If the indicative terms (8.5% Branscombe TAS / 8.0% Seafields WA, both first-mortgage, fixed-term) aren't a fit for {firm} right now, completely understand — won't follow up again.

If timing changes or a different facility size would suit better, the door is open.

— {sender_name}
F2K Capital`,
    max_chars: 800,
  },

  // -------------------------------------------------------------------------
  // Warm DM templates — 1st-degree LinkedIn connections only.
  // No connect-request step (operator and recipient already connected). No
  // credit_signal extraction either — the relationship itself is the signal.
  // Counsel still needs to clear these per v3 brief Sec 5.8, but the risk
  // profile is materially lower than cold outreach.
  // -------------------------------------------------------------------------
  lender_v3_warm_dm_first: {
    channel: 'linkedin_dm' as const,
    subject: null,
    body: `{first_name} — {warm_opener}

F2K is placing $18.7M senior debt directly with selected lenders across two AU property projects:

  ▸ Branscombe Estate (Claremont TAS) — $16.2M senior construction, 8.5% indicative + standard fees, ~22mo, first-mortgage. 40% anchor offtake to Homes Tasmania.

  ▸ Seafields Estate (Geraldton WA) — $2.5M senior land, 8.0% capitalised, ~36mo, first-mortgage over 141 lots. Signed tri-party Coop Agreement Mar 2026.

Pari-passu syndicate, $1-5M tickets typical. V10 Finance Submissions + credit models available.

Worth a 20-min credit conversation? No expectation either way — figured you'd want first look given F2K's on your radar.
{project_urls_block}
— {sender_name}`,
    max_chars: 2000,
  },
  lender_v3_warm_dm_fu: {
    channel: 'linkedin_dm' as const,
    subject: null,
    body: `{first_name} — short follow-up. If a quick call on either F2K facility (Branscombe $16.2M senior construction TAS / Seafields $2.5M senior land WA, both first-mortgage, 8-8.5% indicative) would be useful, I can send V10 IMs over today.

Otherwise no further chase.

— {sender_name}`,
    max_chars: 700,
  },
  lender_v3_warm_dm_final: {
    channel: 'linkedin_dm' as const,
    subject: null,
    body: `{first_name} — closing the loop. If timing isn't right or not a fit for {firm} right now, completely understand — won't follow up again. Door's open if circumstances change.

— {sender_name}`,
    max_chars: 500,
  },
} as const;

// Warm templates skip credit_signal extraction (the relationship IS the signal)
// and rate higher on personalization_score by default. Adding a new warm key?
// Add it here too or the renderer will fail trying to extract credit_signal
// from a partner who likely has thin discovery evidence.
const WARM_TEMPLATE_KEYS = new Set<string>([
  'lender_v3_warm_dm_first',
  'lender_v3_warm_dm_fu',
  'lender_v3_warm_dm_final',
]);

export function isWarmTemplate(key: string): boolean {
  return WARM_TEMPLATE_KEYS.has(key);
}

export type TemplateKey = keyof typeof TEMPLATES;

export function templateChannel(key: string): 'linkedin_connect' | 'linkedin_dm' | 'email' | null {
  if (!(key in TEMPLATES)) return null;
  return TEMPLATES[key as TemplateKey].channel;
}

export async function renderStep(
  templateKey: string,
  partner: RenderPartner,
  context: RenderContext,
): Promise<RenderResult> {
  if (!(templateKey in TEMPLATES)) {
    return { ok: false, reason: `Unknown template_key: ${templateKey}`, blocker: 'unknown_template' };
  }
  const tpl = TEMPLATES[templateKey as TemplateKey];

  if (!partner.contact_name) {
    return {
      ok: false,
      reason: 'Partner has no contact_name; need first name for {first_name} substitution',
      blocker: 'missing_contact',
    };
  }

  const firstName = partner.contact_name.trim().split(/\s+/)[0];
  if (!firstName) {
    return { ok: false, reason: 'contact_name empty after trim', blocker: 'missing_contact' };
  }

  const warm = isWarmTemplate(templateKey);

  // Cold templates require a specific credit signal — generic openers tank
  // reply rates and the v3 brief explicitly forbids them. Warm templates
  // (1st-degree connections) skip this gate: the existing relationship IS
  // the trust signal, no external evidence needed — but they DO get a
  // per-recipient personalised opener so the message doesn't read like
  // an obvious template.
  let signal: CreditSignal | null = null;
  let warmOpener = 'quick one.'; // fallback if Claude call fails — keeps original cadence
  if (!warm) {
    const extracted = await extractCreditSignal(partner);
    if (!extracted.ok) {
      return { ok: false, reason: extracted.reason, blocker: 'no_credit_signal' };
    }
    signal = extracted;
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
    warm_opener: warmOpener,
    project_urls_block: projectUrlsBlock,
    sender_name: context.sender_name,
    sender_role: context.sender_role,
  };

  const subject = tpl.subject ? substitute(tpl.subject, vars) : null;
  const body = substitute(tpl.body, vars);

  // LinkedIn connect notes are hard-capped by LinkedIn at 300 chars. Reject
  // rather than truncate — truncating mid-sentence reads worse than re-rendering
  // with a shorter credit_signal.
  if (tpl.max_chars && body.length > tpl.max_chars) {
    return {
      ok: false,
      reason: `Rendered body ${body.length} chars exceeds max ${tpl.max_chars} for ${templateKey}`,
      blocker: 'no_credit_signal', // operator should re-discover with tighter signal
    };
  }

  return {
    ok: true,
    subject,
    body,
    evidence_refs: {
      template_key: templateKey,
      credit_signal: signal?.short || (warm ? 'warm_relationship' : ''),
      signal_specificity: signal?.specificity || (warm ? 'first_degree_connection' : ''),
      partner_score: partner.weighted_score,
      warm,
    },
    personalization_score: warm
      ? warmPersonalizationScore(partner.weighted_score)
      : personalizationScore(signal!.specificity, partner.weighted_score),
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
  return template.replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? `{${key}}`);
}

interface CreditSignal {
  ok: true;
  short: string;       // ≤ 80 chars, slots into "{credit_signal} suggests fit"
  lead: string;        // ~1-2 sentences, opener for first email
  leadShort: string;   // ~1 sentence, opener for follow-up email
  specificity: 'specific_deal' | 'sector_evidence';
}

interface CreditSignalError {
  ok: false;
  reason: string;
}

async function extractCreditSignal(partner: RenderPartner): Promise<CreditSignal | CreditSignalError> {
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

  if (!evidence.trim()) {
    return { ok: false, reason: 'No discovery evidence on partner — re-run discovery before sequencing' };
  }

  const prompt = `You extract credit signals for direct-lender outreach. The signal must be a SPECIFIC observed credit behaviour by the lender — ideally a named deal, sector participation, or quoted public statement. Generic descriptors ("active in property credit", "experienced lender") are not acceptable.

Evidence on lender ${partner.company_name}:
${evidence}

Return ONLY JSON, no prose:
{
  "short": "<≤80 chars phrase that slots into 'X suggests fit'. Cite the specific evidence. e.g. 'your firm's participation in the Pacific Vista BTR facility (2024)'>",
  "lead": "<1-2 sentence opener for a cold email, grounded in the specific evidence>",
  "leadShort": "<single sentence opener for a follow-up email>",
  "specificity": "specific_deal | sector_evidence | generic"
}

If the evidence is genuinely generic (no specific deal, sector, or quoted statement), return specificity="generic" and we will block the send.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: prompt,
      messages: [{ role: 'user', content: 'Extract the credit signal.' }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, reason: 'LLM returned no JSON object for credit signal extraction' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.specificity === 'generic') {
      return {
        ok: false,
        reason: `Credit signal extraction returned generic; need specific deal/sector evidence. Got: "${parsed.short}"`,
      };
    }

    return {
      ok: true,
      short: String(parsed.short || '').trim(),
      lead: String(parsed.lead || '').trim(),
      leadShort: String(parsed.leadShort || '').trim(),
      specificity: parsed.specificity === 'specific_deal' ? 'specific_deal' : 'sector_evidence',
    };
  } catch (err) {
    return { ok: false, reason: `LLM call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
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
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: prompt,
      messages: [{ role: 'user', content: 'Generate the opener.' }],
    });

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
  specificity: 'specific_deal' | 'sector_evidence',
  partnerScore: number | null,
): number {
  // Specific named-deal evidence is the only way to score above 7. Sector
  // evidence tops out at 7. Partner ICP score nudges within band.
  const base = specificity === 'specific_deal' ? 9 : 6;
  const bump = partnerScore && partnerScore >= 8 ? 1 : 0;
  return Math.min(10, base + bump);
}
