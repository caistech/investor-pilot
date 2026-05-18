/**
 * Scoring prompt builder.
 *
 * Replaces the F2K-specific SCORING_PROMPT that was duplicated across
 * src/app/api/pipeline/discover/route.ts and src/lib/discovery/scorer.ts.
 * Builds the system prompt at request time from the product row, so a
 * second tenant gets their own ICP without code edits.
 *
 * Wall-time discipline: callers fetch the product row once per request
 * (already do — discover-batch fetches at the top of POST). This builder
 * is pure-string assembly and runs once, not per candidate.
 */

export interface ScoringPromptProduct {
  product_pitch: string | null;
  scoring_rubric: string | null;
  icp_categories: string[] | null;
  icp_partner_type: string | null;
  icp_reject_categories: string[] | null;
  icp_special_cases: string[] | null;
  asset_class: string | null;
  geography: string | null;
  /**
   * Migration 027 — funding_type slug. Caller resolves to the canonical
   * describe sentence and passes BOTH in (the slug is kept in the prompt
   * so the LLM sees the literal name the operator picked; the describe
   * is the substantive filter rule).
   */
  funding_type?: string | null;
  funding_type_describe?: string | null;
  /**
   * Rich ICP fields the operator configured on the product / project
   * card. Added 2026-05-18 — the scorer was previously flying blind on
   * buyer_title etc., so Brave-derived "candidates" who were actually
   * journalists at media companies (Business Insider, SmartCompany,
   * Yale SOM) scored 8+ because their article TOPIC matched the
   * verticals. Hard-gating these fields in the prompt sets the LLM up
   * to reject obvious mismatches (title / vertical / company size /
   * stage / explicit exclusions) without the operator having to
   * re-write the scoring_rubric to handle each new failure mode.
   */
  icp_buyer_title?: string | null;
  icp_verticals?: string | null;
  icp_company_size?: string | null;
  icp_stage?: string | null;
  exclusions?: string | null;
  customer_outcomes?: string | null;
  core_mechanism?: string | null;
}

/**
 * Assemble the system prompt for the per-candidate scoring Claude call.
 *
 * Throws if product row is missing the bare minimum (`scoring_rubric`).
 * Caller surfaces this as a 400 — operator should configure
 * `/settings/icp` before discovery can run.
 */
export function buildScoringPrompt(product: ScoringPromptProduct): string {
  if (!product.scoring_rubric) {
    throw new Error(
      'scoring_rubric is not set — generate it on the product card (sales) or project card (funding) before running discovery',
    );
  }

  const pitchLine = product.product_pitch
    ? `You are a prospect scoring analyst for ${product.product_pitch}`
    : 'You are a prospect scoring analyst';

  const assetGeoBits: string[] = [];
  if (product.asset_class) assetGeoBits.push(`Asset class: ${product.asset_class}.`);
  if (product.geography) assetGeoBits.push(`Geography: ${product.geography}.`);
  const assetGeoLine = assetGeoBits.length > 0 ? `\n${assetGeoBits.join(' ')}\n` : '';

  // FUNDING TYPE is the single hardest filter — a Series A LP scored
  // against a construction-debt raise should land at 1-2 across the board
  // and be marked out_of_scope, regardless of how strong their VC
  // credentials look. Emit this as a separate top-of-prompt rule so the
  // scorer can't drift into "well they invest in deals so it's a 7".
  const fundingTypeLine = product.funding_type_describe
    ? `\nFUNDING TYPE BEING RAISED: ${product.funding_type_describe}\n\nThis is a HARD FILTER. Candidates whose stated investment thesis / vehicle / focus does NOT match this funding profile MUST be scored 1-2 across the board and marked "out_of_scope". Examples of common mismatches:\n- VC / angel scored against a debt raise (or vice versa) → out_of_scope\n- Late-stage growth fund scored against pre-seed → out_of_scope\n- Real-estate-only investor scored against a SaaS Series A → out_of_scope\n- Equity-only investor scored against a working-capital line → out_of_scope\nIf in doubt about the candidate's actual focus, score conservatively low rather than guessing high.\n`
    : product.funding_type
      ? `\nFunding type: ${product.funding_type}\n`
      : '';

  const categories = product.icp_categories ?? [];
  const categoryLine = categories.length > 0
    ? categories.join(' | ')
    : 'unknown';

  const partnerType = product.icp_partner_type ?? 'unknown';

  const rejectList = product.icp_reject_categories ?? [];
  const rejectSection = rejectList.length > 0
    ? `\n\nREJECT (score 0-2 across the board, mark category as "out_of_scope"):\n${rejectList.map((c) => `- ${c}`).join('\n')}`
    : '';

  const specialCases = product.icp_special_cases ?? [];
  const specialSection = specialCases.length > 0
    ? `\n\nDO NOT REJECT (special cases — these may look adjacent to a reject category but are explicitly in scope):\n${specialCases.map((c) => `- ${c}`).join('\n')}`
    : '';

  // Hard-gate the rich ICP fields the operator configured. Each that's
  // set becomes an explicit reject criterion the LLM must apply before
  // assigning any non-trivial score. Without this, the only "hard"
  // filters the scorer saw were icp_reject_categories + funding_type;
  // operator-set buyer_title / verticals / exclusions / company_size /
  // stage went into the user-message productContext as soft hints and
  // were routinely ignored when the article topic matched the rubric.
  const hardGateLines: string[] = [];
  if (product.icp_buyer_title?.trim()) {
    hardGateLines.push(
      `- BUYER TITLE: The contact must plausibly hold one of these titles (or a senior equivalent / superset): ${product.icp_buyer_title.trim()}. ` +
        `Apply your judgement — if the contact's actual title clearly does not match this buyer profile, mark category="out_of_scope" and cap every dimension at 1, regardless of how well the company itself matches the other criteria.`,
    );
  }
  if (product.icp_verticals?.trim()) {
    hardGateLines.push(
      `- VERTICALS: The company must operate in (or sell into) one of: ${product.icp_verticals.trim()}. ` +
        `Apply your judgement on the company's primary business — companies that merely cover or report on the verticals (rather than operating in them) are not a fit.`,
    );
  }
  if (product.icp_company_size?.trim()) {
    hardGateLines.push(
      `- COMPANY SIZE / STAGE PROFILE: Target is ${product.icp_company_size.trim()}. Mismatched scale (e.g. solo creator, Fortune 50, government department) is out_of_scope.`,
    );
  }
  if (product.icp_stage?.trim()) {
    hardGateLines.push(
      `- COMPANY STAGE: ${product.icp_stage.trim()}. Companies clearly outside this stage band are out_of_scope.`,
    );
  }
  if (product.exclusions?.trim()) {
    hardGateLines.push(
      `- EXPLICIT EXCLUSIONS (operator-defined — these MUST score 0-2 and category="out_of_scope"): ${product.exclusions.trim()}`,
    );
  }

  const hardGateSection = hardGateLines.length > 0
    ? `\n\nHARD-GATE FILTERS (apply BEFORE the dimension scoring rubric — a candidate that fails ANY of these is out_of_scope and the rubric below does not save them):\n${hardGateLines.join('\n')}`
    : '';

  // Anchor what the offering actually IS and what value it delivers, so
  // the scorer can reason "would this candidate plausibly buy what we
  // sell?" rather than "does the candidate's vague description overlap
  // with the verticals list?".
  const offeringAnchor: string[] = [];
  if (product.core_mechanism?.trim()) {
    offeringAnchor.push(`Core mechanism: ${product.core_mechanism.trim()}`);
  }
  if (product.customer_outcomes?.trim()) {
    offeringAnchor.push(`Customer outcomes delivered: ${product.customer_outcomes.trim()}`);
  }
  const offeringAnchorSection = offeringAnchor.length > 0
    ? `\n\nWHAT THIS OFFERING IS:\n${offeringAnchor.join('\n')}\n`
    : '';

  // When the operator has set a buyer_title, the LLM MUST evaluate
  // whether the contact actually matches it and emit the result as a
  // separate field. The scorer then deterministically forces
  // out_of_scope when the LLM says no — same enforcement pattern as
  // the existing isOutOfScope category check. Without this, the LLM
  // routinely scores company-fit high (verticals match, etc.) and
  // gives the buyer-title mismatch insufficient weight, so a "Partner
  // at a VC firm" rated 9/10 despite being clearly not the configured
  // buyer (CTO / Head of Product / Founder/CEO).
  const buyerTitleEvalField = product.icp_buyer_title?.trim()
    ? `,\n  "buyer_title_match": "<yes if the contact's actual title plausibly matches the buyer profile above; no if it clearly does not (e.g. contact is an investor/partner/journalist/consultant/advisor when the buyer profile is operator/CTO/founder; or vice versa). When uncertain, return no — being strict here protects the operator from chasing non-buyers.>"`
    : '';

  return `${pitchLine}. Given a person/firm description from search results, score them on 5 dimensions for fit.
${assetGeoLine}${fundingTypeLine}${offeringAnchorSection}${hardGateSection}

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "audience_overlap_score": <1-10>,
  "audience_overlap_notes": "<one sentence>",
  "complementarity_score": <1-10>,
  "complementarity_notes": "<one sentence>",
  "partner_readiness_score": <1-10>,
  "partner_readiness_notes": "<one sentence>",
  "reachability_score": <1-10>,
  "reachability_notes": "<one sentence>",
  "strategic_leverage_score": <1-10>,
  "strategic_leverage_notes": "<one sentence>",
  "confidence_score": "<normal or low-confidence>",
  "category": "<${categoryLine}>",
  "partner_type": "<${partnerType}>"${buyerTitleEvalField}
}

Scoring dimensions:

${product.scoring_rubric}${rejectSection}${specialSection}

If a dimension relies more on inference than evidence, cap at 4/10 and set confidence_score to "low-confidence".`;
}
