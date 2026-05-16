/**
 * POST /api/products/generate-scoring-rubric
 *
 * Auto-generates the ICP scoring configuration for a product:
 * scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories,
 * icp_special_cases. Writes them back to the products row so the discovery
 * scorer has everything it needs to run.
 *
 * Body:
 *   { product_id: string }    required (no auto-default — operator picks
 *                             which product to configure)
 *
 * 400 if product missing pitch + one-line; 429 if LLM cap exhausted;
 * 200 with { ok, scoring_rubric, icp_partner_type, ... } on success.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { generateScoringRubric } from '@/lib/discovery/generate-scoring-rubric';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const productId: string | undefined = body.product_id;
  if (!productId) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.organisation_id;

  const llmCap = await checkCap(organisation_id, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }

  const { data: product } = await db
    .from('products')
    .select('id, organisation_id, name, one_sentence_description, product_pitch, core_mechanism, customer_outcomes, icp_buyer_title, icp_verticals, icp_company_size, icp_stage, partner_types, asset_class, geography, ticket_size_min_label, ticket_size_max_label, exclusions')
    .eq('id', productId)
    .single();

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  if (product.organisation_id !== organisation_id) {
    return NextResponse.json({ error: 'Product belongs to a different organisation' }, { status: 403 });
  }

  let result;
  try {
    result = await generateScoringRubric(product, {
      organisation_id,
      route: '/api/products/generate-scoring-rubric',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const { error: updateError } = await db
    .from('products')
    .update({
      scoring_rubric: result.scoring_rubric,
      icp_categories: result.icp_categories,
      icp_partner_type: result.icp_partner_type,
      icp_reject_categories: result.icp_reject_categories,
      icp_special_cases: result.icp_special_cases,
    })
    .eq('id', productId);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to save scoring config: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    product_id: productId,
    scoring_rubric: result.scoring_rubric,
    icp_categories: result.icp_categories,
    icp_partner_type: result.icp_partner_type,
    icp_reject_categories: result.icp_reject_categories,
    icp_special_cases: result.icp_special_cases,
    next_step: 'Click "Find Investors" on this product to run a discovery batch using the new rubric.',
  });
}
