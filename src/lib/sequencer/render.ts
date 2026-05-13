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
 * Sprint 1 scope:
 *   - 6 template_keys for lender v3 sequence (see seed route)
 *   - Sender identity is hard-coded here. Move to organisations table when 2nd
 *     customer joins.
 *   - personalization_score is a heuristic over the rendered body, not an
 *     additional LLM call.
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

// Hardcoded Sprint 1. Move to organisations table when multi-tenant ships.
const SENDER_NAME = 'Dennis McMahon';
const SENDER_ROLE = 'Development Manager, Factory2Key Pty Ltd | F2K Capital';

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
    body: `{first_name} — quick one. F2K is placing $18.7M senior debt directly with selected lenders across two AU property projects:

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
  // the trust signal, no external evidence needed.
  let signal: CreditSignal | null = null;
  if (!warm) {
    const extracted = await extractCreditSignal(partner);
    if (!extracted.ok) {
      return { ok: false, reason: extracted.reason, blocker: 'no_credit_signal' };
    }
    signal = extracted;
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
    project_urls_block: projectUrlsBlock,
    sender_name: SENDER_NAME,
    sender_role: SENDER_ROLE,
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
  const evidence = [
    partner.audience_overlap_notes,
    partner.complementarity_notes,
    partner.partner_readiness_notes,
  ]
    .filter(Boolean)
    .join('\n');

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
