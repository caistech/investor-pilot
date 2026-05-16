/**
 * Draft prompt builder.
 *
 * Replaces the hardcoded `DRAFT_PROMPT` constant that previously baked F2K's
 * facility names, rates, signature, and forbidden-terms list into
 * src/app/api/pipeline/draft/route.ts. Builds the system prompt at request
 * time from the product row + the caller's sender identity, so a second
 * tenant gets their own pitch without code edits.
 *
 * Wall-time discipline: the caller must fetch the product row once per
 * request (already does — `db.from('products').select(...)`). This builder
 * is pure-string assembly and runs once per request, not per partner.
 */

export interface DraftPromptProduct {
  product_pitch: string | null;
  facility_summary: DraftFacility[] | null;
  asset_class: string | null;
  geography: string | null;
  ticket_size_min_label: string | null;
  ticket_size_max_label: string | null;
  draft_compliance_forbidden_terms: string[] | null;
}

export interface DraftFacility {
  name: string;
  size_label: string;
  rate_label: string;
  term_label: string;
  evidence_anchor: string | null;
}

export interface DraftPromptSender {
  sender_name: string;
  sender_role: string;
}

/**
 * Assemble the system prompt for the per-partner draft Claude call.
 *
 * Throws if the product row is missing the bare minimum (`product_pitch`).
 * Caller surfaces this as a 400 — operator should configure
 * `/settings/product` before drafting can run.
 */
export function buildDraftPrompt(product: DraftPromptProduct, sender: DraftPromptSender): string {
  if (!product.product_pitch) {
    throw new Error(
      'product.product_pitch is not set — configure your product pitch via /settings before drafting',
    );
  }

  const facilities = product.facility_summary ?? [];
  const facilityLines = facilities.length > 0
    ? facilities
        .map((f) => {
          const anchor = f.evidence_anchor ? `, ${f.evidence_anchor}` : '';
          return `    * ${f.name} — ${f.size_label}, ${f.rate_label}, ${f.term_label}${anchor}`;
        })
        .join('\n')
    : '    * (no facilities configured for this product yet)';

  const assetClassLine = product.asset_class
    ? `Asset class: ${product.asset_class}.`
    : '';
  const geographyLine = product.geography ? `Geography: ${product.geography}.` : '';

  const ticketRoutingLines: string[] = [];
  if (product.ticket_size_max_label) {
    ticketRoutingLines.push(`    * Larger tickets (${product.ticket_size_max_label}) → combined platform / multi-facility pitch`);
  }
  if (product.ticket_size_min_label) {
    ticketRoutingLines.push(`    * Smaller tickets (${product.ticket_size_min_label}) → single-facility pitch`);
  }
  const ticketRouting = ticketRoutingLines.length > 0
    ? `\n- Choose lead facility per recipient ticket size:\n${ticketRoutingLines.join('\n')}`
    : '';

  const forbidden = product.draft_compliance_forbidden_terms ?? [];
  const forbiddenSection = forbidden.length > 0
    ? `\nFORBIDDEN (these will be rejected):\n${forbidden.map((t) => `- "${t}"`).join('\n')}`
    : '';

  return `You are an outreach email writer for ${product.product_pitch}

Write a personalised cold credit-conversation email to a direct lender or family office private debt allocator about participation in the facilities below. This is a CREDIT CONVERSATION, not a product-suitability conversation. The recipient is the decision-maker, not someone placing other people's money.

${[assetClassLine, geographyLine].filter(Boolean).join(' ')}

Return ONLY a JSON object (no markdown, no explanation):
{
  "subject": "<concrete, project-specific subject line — names a facility size and the recipient's relevant credit-signal>",
  "body": "<email body, under 200 words>",
  "partnership_motion": "<senior debt syndication | first-mortgage participation | combined platform position | individual facility>",
  "selected_gtm_angle": "<one sentence describing the recipient's likely fit angle>"
}

EMAIL RULES:
- Subject: concrete, mentions a specific facility size and/or project
- Opening: one sentence grounded in the recipient's documented credit history (the "credit signal")
- Body: lead with concrete facility specifics:
${facilityLines}${ticketRouting}
- Ask: one specific low-commitment next step — "20-minute credit conversation" + calendar link
- Length: under 200 words
- Tone: professional, founder-to-credit-principal. Direct, factual, no hype.
- Signature: ${sender.sender_name} | ${sender.sender_role}
${forbiddenSection}

NEVER:
- Fabricate specific claims about the recipient's prior deals (only cite what's in the discovery evidence)`;
}

// =============================================================================
// Investor-side draft prompt — used when the prospects belong to a project
// (fundraising mode) rather than a product (sales mode). The role of
// project.investment_thesis is the same as products.product_pitch; round
// labels stand in for facility summaries.
// =============================================================================

export interface InvestorDraftPromptProject {
  name: string;
  investment_thesis: string | null;
  target_round: string | null;
  round_size_label: string | null;
  asset_class: string | null;
  geography: string | null;
  sponsor: string | null;
  description: string | null;
}

export function buildInvestorDraftPrompt(
  project: InvestorDraftPromptProject,
  sender: DraftPromptSender,
): string {
  if (!project.investment_thesis) {
    throw new Error(
      'project.investment_thesis is not set — open the project card and generate the pitch before drafting',
    );
  }

  const roundLine = project.target_round
    ? `Round: ${project.target_round}${project.round_size_label ? ` (${project.round_size_label})` : ''}.`
    : project.round_size_label
      ? `Raise size: ${project.round_size_label}.`
      : '';
  const assetGeoLine = [
    project.asset_class ? `Sector: ${project.asset_class}.` : '',
    project.geography ? `Geography: ${project.geography}.` : '',
  ].filter(Boolean).join(' ');
  const sponsorLine = project.sponsor ? `Operator/sponsor: ${project.sponsor}.` : '';

  return `You are an outreach email writer pitching the following raise to an investor:

${project.investment_thesis}

${[roundLine, assetGeoLine, sponsorLine].filter(Boolean).join(' ')}

Write a personalised cold investor-introduction email. The recipient is a
partner / principal / investment director at a fund or family office whose
mandate matches this raise. This is an INVESTMENT CONVERSATION, not a
product demo.

Return ONLY a JSON object (no markdown, no explanation):
{
  "subject": "<concrete subject line — names round size and a hook tied to the recipient's thesis>",
  "body": "<email body, under 200 words>",
  "partnership_motion": "<lead investor | follow-on | strategic | first conversation>",
  "selected_gtm_angle": "<one sentence describing the recipient's likely fit angle>"
}

EMAIL RULES:
- Subject: concrete, mentions round + a fit-specific hook
- Opening: one sentence grounded in something documented about the recipient
  (their thesis area, a recent investment, their portfolio) — this is the
  "fit signal"
- Body: lead with one or two concrete proof points (traction / customers /
  unit economics if implied by the thesis), then the round mechanics
- Ask: one specific low-commitment next step — "20-minute intro call" + offer to share the deck / data room
- Length: under 200 words
- Tone: professional, founder-to-investor. Direct, factual, no hype. No buzzwords.
- Signature: ${sender.sender_name} | ${sender.sender_role}

NEVER:
- Fabricate specific claims about the recipient's prior investments (only cite what's in the discovery evidence)
- Promise returns, multiples, or IRR — describe the opportunity, not outcomes`;
}
