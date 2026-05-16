/**
 * Hard-coded seed content for the v3 lender sequence templates.
 *
 * Lives outside src/lib/sequencer/render.ts so the seed route can import
 * structured template content without pulling in the renderer's Anthropic
 * client + helpers. After Phase D of the multi-tenant config layer the
 * authoritative copy of each template body lives in
 * `sequence_templates.steps[i].body`; this file provides:
 *
 *   1. Fresh-tenant seed content via /api/sequences/seed
 *   2. Backwards-compat fallback when an existing row's `steps[i].body`
 *      is null (rows seeded before Phase D had only a `template_key`
 *      reference, no inline content)
 */

export interface SeedTemplate {
  channel: 'linkedin_connect' | 'linkedin_dm' | 'email';
  subject: string | null;
  body: string;
  max_chars: number;
  is_warm: boolean;
}

export const SEED_TEMPLATES: Record<string, SeedTemplate> = {
  lender_v3_connect: {
    channel: 'linkedin_connect',
    subject: null,
    body: `{first_name} — F2K is placing two AU property dev senior debt facilities directly with selected lenders. {credit_signal} suggests fit. Wholesale, first-mortgage, $1-5M tickets. Open to a brief conversation? — {sender_name}`,
    max_chars: 300,
    is_warm: false,
  },
  lender_v3_dm_first: {
    channel: 'linkedin_dm',
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
    max_chars: 2000,
    is_warm: false,
  },
  lender_v3_email_first: {
    channel: 'email',
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
    is_warm: false,
  },
  lender_v3_email_fu1: {
    channel: 'email',
    subject: `Re: {first_name} — F2K $18.7M AU property senior debt`,
    body: `Hi {first_name},

Quick follow-up on the F2K senior debt position. {credit_signal_lead_short}

If a 20-minute credit conversation on either facility (Branscombe $16.2M senior construction TAS / Seafields $2.5M senior land WA, both first-mortgage, 8-8.5% indicative) would be useful, I can share the V10 Finance Submissions and project models.

If not the right moment or not a fit, no further follow-up needed.

— {sender_name}
F2K Capital`,
    max_chars: 1200,
    is_warm: false,
  },
  lender_v3_dm_fu: {
    channel: 'linkedin_dm',
    subject: null,
    body: `{first_name} — short follow-up. If a 20-min call on either of the F2K facilities (Branscombe $16.2M senior construction, Seafields $2.5M senior land, both first-mortgage, 8-8.5% indicative) would be useful, I can share V10 IMs and credit models. Otherwise no further follow-up.

— {sender_name}`,
    max_chars: 600,
    is_warm: false,
  },
  lender_v3_email_fu2: {
    channel: 'email',
    subject: `Closing the loop — F2K senior debt`,
    body: `Hi {first_name},

Closing the loop on the F2K $18.7M senior debt position. If the indicative terms (8.5% Branscombe TAS / 8.0% Seafields WA, both first-mortgage, fixed-term) aren't a fit for {firm} right now, completely understand — won't follow up again.

If timing changes or a different facility size would suit better, the door is open.

— {sender_name}
F2K Capital`,
    max_chars: 800,
    is_warm: false,
  },
  lender_v3_warm_dm_first: {
    channel: 'linkedin_dm',
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
    is_warm: true,
  },
  lender_v3_warm_dm_fu: {
    channel: 'linkedin_dm',
    subject: null,
    body: `{first_name} — short follow-up. If a quick call on either F2K facility (Branscombe $16.2M senior construction TAS / Seafields $2.5M senior land WA, both first-mortgage, 8-8.5% indicative) would be useful, I can send V10 IMs over today.

Otherwise no further chase.

— {sender_name}`,
    max_chars: 700,
    is_warm: true,
  },
  lender_v3_warm_dm_final: {
    channel: 'linkedin_dm',
    subject: null,
    body: `{first_name} — closing the loop. If timing isn't right or not a fit for {firm} right now, completely understand — won't follow up again. Door's open if circumstances change.

— {sender_name}`,
    max_chars: 500,
    is_warm: true,
  },
};

/** Returns the seed template body/subject for a given template_key, or null if unknown. */
export function getSeedTemplate(templateKey: string): SeedTemplate | null {
  return SEED_TEMPLATES[templateKey] ?? null;
}
