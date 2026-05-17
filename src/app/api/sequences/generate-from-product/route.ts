/**
 * POST /api/sequences/generate-from-product
 *
 * Auto-generates a tailored sequence template from a product's pitch + ICP
 * + the organisation's sender identity. Replaces the F2K-hardcoded seed
 * route for any tenant whose product is not F2K's senior debt fund.
 *
 * Body:
 *   { product_id?: string }   defaults to the org's first active product
 *
 * Behaviour:
 *   - 400 if no product / no sender identity / no pitch (operator needs to
 *     finish setup in /products + /settings first)
 *   - 429 if LLM monthly cap exhausted
 *   - 200 with { ok, template_id, template_name, steps_count } on success
 *
 * Idempotency: upserts on (organisation_id, vertical) so re-running for the
 * same product replaces the prior auto-generated template rather than
 * piling up duplicates. Manually-edited templates aren't touched.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { generateSequenceFromProduct } from '@/lib/sequencer/generate-from-product';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  let productId: string | undefined = body.product_id;

  // Resolve organisation
  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.organisation_id;

  // LLM cap pre-flight
  const llmCap = await checkCap(organisation_id, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }

  // Default to first active product
  if (!productId) {
    const { data: firstProduct } = await db
      .from('products')
      .select('id')
      .eq('organisation_id', organisation_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    productId = firstProduct?.id;
  }
  if (!productId) {
    return NextResponse.json(
      { error: 'No active product found. Create a product in /products before generating a sequence.' },
      { status: 400 },
    );
  }

  // Load product + sender + KB sources in parallel
  const [{ data: product }, { data: org }, { data: kbRows }] = await Promise.all([
    db
      .from('products')
      .select('id, name, one_sentence_description, product_pitch, core_mechanism, customer_outcomes, icp_buyer_title, icp_verticals, icp_company_size, asset_class, geography, ticket_size_min_label, ticket_size_max_label, partner_types, compliance_mode')
      .eq('id', productId)
      .single(),
    db
      .from('organisations')
      .select('name, sender_name, sender_role')
      .eq('id', organisation_id)
      .single(),
    db
      .from('product_sources')
      .select('title, content')
      .eq('product_id', productId)
      .eq('processing_status', 'completed'),
  ]);

  const kb = (kbRows ?? []).filter((s) => s.content);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  if (!org?.sender_name || !org?.sender_role) {
    return NextResponse.json(
      { error: 'Sender identity is not set. Visit /settings to fill in sender_name and sender_role before generating a sequence.' },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await generateSequenceFromProduct(
      product,
      {
        sender_name: org.sender_name,
        sender_role: org.sender_role,
        organisation_name: org.name as string,
      },
      kb,
      { organisation_id, route: '/api/sequences/generate-from-product' },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /aborted|timeout|took longer than/i.test(message);
    return NextResponse.json(
      { error: message, retryable: isTimeout },
      { status: isTimeout ? 504 : 502 },
    );
  }

  // Pin the vertical slug deterministically to the product so re-running
  // ALWAYS finds and updates the same row. Mirror of the project-side
  // fix shipped same day — see /api/projects/generate-sequence for the
  // full context (LLM-picked verticals were drifting per regen, the
  // upsert key never matched, templates accumulated).
  const deterministicVertical = `auto_product_${productId}`;
  const llmVertical = result.vertical;

  const { data: existing } = await db
    .from('sequence_templates')
    .select('id')
    .eq('organisation_id', organisation_id)
    .eq('vertical', deterministicVertical)
    .maybeSingle();

  const templateRow = {
    organisation_id,
    name: result.template_name,
    description: result.template_description
      ? `${result.template_description}${llmVertical && llmVertical !== deterministicVertical ? ` (LLM category: ${llmVertical})` : ''}`
      : null,
    vertical: deterministicVertical,
    // Inherits from product.compliance_mode (migration 026). Operator
    // picks per-product in the product edit form; brand-new rows
    // default to 'standard' (light-touch).
    compliance_mode: (product.compliance_mode as string) || 'standard',
    is_active: true,
    // Routing tag — assign-batch uses this to pick the right template
    // per partner (product-scoped partners get target_kind='product'
    // templates, project-scoped partners get target_kind='project').
    target_kind: 'product',
    steps: result.steps,
  };

  let templateId: string;
  if (existing?.id) {
    const { error: updateError } = await db
      .from('sequence_templates')
      .update({
        name: templateRow.name,
        description: templateRow.description,
        is_active: true,
        steps: templateRow.steps,
      })
      .eq('id', existing.id);
    if (updateError) {
      return NextResponse.json({ error: `Failed to update template: ${updateError.message}` }, { status: 500 });
    }
    templateId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await db
      .from('sequence_templates')
      .insert(templateRow)
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json({ error: `Failed to insert template: ${insertError?.message || 'no row returned'}` }, { status: 500 });
    }
    templateId = inserted.id;
  }

  return NextResponse.json({
    ok: true,
    template_id: templateId,
    template_name: result.template_name,
    template_description: result.template_description,
    vertical: result.vertical,
    steps_count: result.steps.length,
    next_step: 'Edit individual step copy in /settings/templates. The first send will go through your normal approval queue.',
  });
}
