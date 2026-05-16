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

  return `${pitchLine}. Given a person/firm description from search results, score them on 5 dimensions for fit.
${assetGeoLine}
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
  "partner_type": "<${partnerType}>"
}

Scoring dimensions:

${product.scoring_rubric}${rejectSection}${specialSection}

If a dimension relies more on inference than evidence, cap at 4/10 and set confidence_score to "low-confidence".`;
}
