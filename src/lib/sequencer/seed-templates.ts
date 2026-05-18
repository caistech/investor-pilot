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
  // F2K Funding-mode COLD-tier templates (Tier 3 / Tier 4).
  // Same 6 principles + 4-tier framework as the Sales-mode bodies:
  // friendly opener, value-first (sponsor + named-deal proof), fit-framed
  // soft ask, single low-commitment CTA (the V10 IM, sent on reply).
  lender_v3_connect: {
    channel: 'linkedin_connect',
    subject: null,
    body: `Hi {first_name} — F2K is placing senior construction debt for Branscombe Estate (TAS, 37 modular dwellings, first-mortgage, 40% Homes Tasmania offtake). If construction-finance fits the mandate, happy to send the V10 IM — a 10-min read. — {sender_name}`,
    max_chars: 300,
    is_warm: false,
  },
  lender_v3_dm_first: {
    channel: 'linkedin_dm',
    subject: null,
    body: `Hi {first_name} — thanks for connecting.

{credit_signal_lead}

F2K (factory2key.com.au) is placing $16.2M senior construction debt for Branscombe Estate — 37 modular dwellings, Claremont TAS. First-mortgage, 8.5% indicative + standard fees, ~22mo term, with a 40% anchor offtake already underwritten by Homes Tasmania. Pari-passu syndicate, $1-5M tickets typical.

If construction-finance for residential modular sits in your mandate, happy to send the V10 IM across — it's a 10-min read.

If not the right moment, completely understand.
{project_urls_block}
— {sender_name}
{sender_role}`,
    max_chars: 1500,
    is_warm: false,
  },
  lender_v3_email_first: {
    channel: 'email',
    subject: `Branscombe TAS senior construction — fit for {firm}?`,
    body: `Hi {first_name},

Short note — know your inbox is heavy.

{credit_signal_lead}

F2K is placing $16.2M senior construction debt for the Branscombe Estate project — 37 modular dwellings, Claremont TAS, first-mortgage, 8.5% p.a. indicative + standard fees, ~22 months, with a 40% anchor offtake already underwritten by Homes Tasmania (CHP route). Pari-passu syndicate; typical ticket band $1-5M.

If construction-finance for residential modular sits in {firm}'s mandate, the V10 Finance Submission is a 10-minute read — reply and I'll send across.

No reply needed if it's not a fit.
{project_urls_block}
— {sender_name}
{sender_role}`,
    max_chars: 1800,
    is_warm: false,
  },
  lender_v3_email_fu1: {
    channel: 'email',
    subject: `{first_name} — quick follow-up`,
    body: `{first_name} — quick follow-up, no reply needed if timing's off.

{credit_signal_lead_short}

If the F2K Branscombe facility (first-mortgage, 8.5%, ~22mo, anchor offtake) might fit the mandate, the V10 IM is a 10-min read — happy to send across.

Otherwise no chase.

— {sender_name}`,
    max_chars: 900,
    is_warm: false,
  },
  lender_v3_dm_fu: {
    channel: 'linkedin_dm',
    subject: null,
    body: `{first_name} — short follow-up, no reply needed if timing's off.

If the Branscombe facility (first-mortgage, 8.5%, anchor offtake) might fit, the V10 IM is a 10-min read — happy to send across.

Otherwise no chase.

— {sender_name}`,
    max_chars: 500,
    is_warm: false,
  },
  lender_v3_email_fu2: {
    channel: 'email',
    subject: `Closing the loop`,
    body: `{first_name},

Closing the loop — I won't follow up again on this one.

If Branscombe (or future F2K senior-debt placements) ever becomes relevant for {firm}, the door's open — just reply and the V10 IM goes across.

— {sender_name}
{sender_role}`,
    max_chars: 700,
    is_warm: false,
  },
  // Funding-mode warm DMs (Tier 1 — 1st-degree). Follow docs/messaging-framework.md:
  // friendly opener, value-first (sponsor + anchor proof), fit-framed soft ask,
  // single low-commitment CTA (the V10 IM, sent on reply — not a calendar push).
  lender_v3_warm_dm_first: {
    channel: 'linkedin_dm',
    subject: null,
    body: `Hi {first_name} — {warm_opener}

F2K is placing senior construction debt for Branscombe Estate (37 modular dwellings, Claremont TAS) — first-mortgage, 8.5% indicative, ~22mo, with a 40% offtake already underwritten by Homes Tasmania. Pari-passu syndicate, $1-5M tickets typical.

If construction-finance for residential modular sits in your mandate, happy to send the V10 IM across — a 10-min read.

No expectation either way.
{project_urls_block}
— {sender_name}`,
    max_chars: 1500,
    is_warm: true,
  },
  lender_v3_warm_dm_fu: {
    channel: 'linkedin_dm',
    subject: null,
    body: `{first_name} — short follow-up, no reply needed if timing's off.

If the F2K Branscombe facility (first-mortgage, 8.5%, 22mo, anchor offtake) might fit the mandate, the V10 IM is a 10-min read — happy to send across.

Otherwise no chase.

— {sender_name}`,
    max_chars: 600,
    is_warm: true,
  },
  lender_v3_warm_dm_final: {
    channel: 'linkedin_dm',
    subject: null,
    body: `{first_name} — closing the loop, won't follow up again on this one.

If the Branscombe facility (or future F2K senior-debt placements) ever becomes relevant for {firm}, the door's open — just reply and the V10 IM goes across.

— {sender_name}`,
    max_chars: 500,
    is_warm: true,
  },
};

/** Returns the seed template body/subject for a given template_key, or null if unknown. */
export function getSeedTemplate(templateKey: string): SeedTemplate | null {
  return SEED_TEMPLATES[templateKey] ?? null;
}
