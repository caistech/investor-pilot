/**
 * POST /api/webhooks/pipeline-intake
 *
 * Receives product profiles from Corporate AI Solutions pipeline when
 * a product passes validation (GO decision). Creates:
 * 1. Product record for tracking
 * 2. Distributor outreach channel with ICP + pitch
 * 3. End-user feedback channel
 *
 * Contract: cais-shared-services/product-factory/cross-cutting/PIPELINE_INVESTORPILOT_INTEGRATION.md
 *
 * Self-authenticating (HMAC-SHA256 of body using shared secret in
 * PIPELINE_INTAKE_WEBHOOK_SECRET).
 */

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 60;

interface PipelineProductPayload {
  product_id: string;
  product_name: string;
  description: string;
  landing_page_url: string;
  distributor_icp: string;
  distributor_pitch: string | null;
  end_user_icp: string;
  friction: string;
  customer_outcomes: string | null;
  core_mechanism: string | null;
  target_verticals: string | null;
  regulated_flag: boolean;
  cta_spec: {
    destination: string;
    events: string[];
  };
  validation_summary: {
    hard_gates_passed: number;
    weighted_score: number;
    gates_ready: boolean;
  };
  timestamp: string;
  // New ICP fields for tight targeting
  icp_company_size?: string | null;
  icp_stage?: string | null;
  icp_buyer_title?: string | null;
  icp_user_title?: string | null;
  icp_stack_tools?: string | null;
  traction_arr?: string | null;
  traction_customers?: string | null;
}

function verifySignature(rawBody: string, signatureHeader: string | null): { ok: boolean; reason?: string } {
  if (!signatureHeader) return { ok: false, reason: 'missing X-Pipeline-Signature' };
  const secret = process.env.PIPELINE_INTAKE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'PIPELINE_INTAKE_WEBHOOK_SECRET not configured' };

  const match = signatureHeader.match(/^sha256=([a-f0-9]+)$/i);
  if (!match) return { ok: false, reason: 'signature header must be "sha256=<hex>"' };

  const expected = match[1].toLowerCase();
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (expected.length !== computed.length) return { ok: false, reason: 'signature length mismatch' };

  let safeEqual = false;
  try {
    safeEqual = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(computed, 'hex'));
  } catch {
    return { ok: false, reason: 'signature parse failed' };
  }
  return safeEqual ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-pipeline-signature');

  const sigResult = verifySignature(rawBody, signatureHeader);
  if (!sigResult.ok) {
    console.warn(`[webhooks/pipeline-intake] signature rejected: ${sigResult.reason}`);
    return NextResponse.json({ error: sigResult.reason || 'signature invalid' }, { status: 401 });
  }

  let payload: PipelineProductPayload;
  try {
    payload = JSON.parse(rawBody) as PipelineProductPayload;
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 });
  }

  if (!payload.product_id || !payload.product_name) {
    return NextResponse.json({ error: 'product_id and product_name are required' }, { status: 400 });
  }

  const db = createServiceClient();

  // For now, associate with first organisation (multi-tenant: would need org lookup)
  const { data: firstOrg } = await db
    .from('organisations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstOrg) {
    return NextResponse.json({ error: 'no organisations configured' }, { status: 500 });
  }

  const organisationId = firstOrg.id as string;

  // §4 DESIGN CHANGE: Create TWO products - one for each ICP stream
  // This ensures clean separation: different templates, different tracking, different signals
  const distributorProductId = `${payload.product_id}-distributor`;
  const endUserProductId = `${payload.product_id}-end-user`;

  // Create DISTRIBUTOR product
  const { data: distributorProduct, error: distributorErr } = await db
    .from('products')
    .upsert({
      organisation_id: organisationId,
      external_product_id: distributorProductId,
      name: `${payload.product_name} (Distributors)`,
      one_sentence_description: payload.description,
      landing_page_url: payload.cta_spec.destination,
      distributor_icp: payload.distributor_icp,
      distributor_pitch: payload.distributor_pitch,
      end_user_icp: null,
      friction: payload.friction,
      core_mechanism: payload.core_mechanism,
      customer_outcomes: payload.customer_outcomes,
      icp_verticals: payload.target_verticals,
      regulated_flag: payload.regulated_flag,
      cta_destination: payload.cta_spec.destination,
      cta_events: payload.cta_spec.events,
      validation_hard_gates_passed: payload.validation_summary.hard_gates_passed,
      validation_weighted_score: payload.validation_summary.weighted_score,
      validation_gates_ready: payload.validation_summary.gates_ready,
      intake_source: 'pipeline',
      intake_timestamp: payload.timestamp,
      icp_company_size: payload.icp_company_size || null,
      icp_stage: payload.icp_stage || null,
      icp_buyer_title: payload.icp_buyer_title || null,
      icp_user_title: payload.icp_user_title || null,
      icp_stack_tools: payload.icp_stack_tools || null,
      traction_arr: payload.traction_arr || null,
      traction_customers: payload.traction_customers || null,
    }, { onConflict: 'external_product_id,organisation_id' })
    .select('id')
    .single();

  if (distributorErr) {
    console.error(`[webhooks/pipeline-intake] distributor product insert failed:`, distributorErr);
    return NextResponse.json({ error: 'storage failed', detail: distributorErr.message }, { status: 500 });
  }

  // Create END-USER product
  const { data: endUserProduct, error: endUserErr } = await db
    .from('products')
    .upsert({
      organisation_id: organisationId,
      external_product_id: endUserProductId,
      name: `${payload.product_name} (End Users)`,
      one_sentence_description: payload.description,
      landing_page_url: payload.cta_spec.destination,
      distributor_icp: null,
      distributor_pitch: null,
      end_user_icp: payload.end_user_icp,
      friction: payload.friction,
      customer_outcomes: payload.customer_outcomes,
      core_mechanism: payload.core_mechanism,
      icp_verticals: payload.target_verticals,
      regulated_flag: payload.regulated_flag,
      cta_destination: payload.cta_spec.destination,
      cta_events: payload.cta_spec.events,
      validation_hard_gates_passed: payload.validation_summary.hard_gates_passed,
      validation_weighted_score: payload.validation_summary.weighted_score,
      validation_gates_ready: payload.validation_summary.gates_ready,
      intake_source: 'pipeline',
      intake_timestamp: payload.timestamp,
      icp_company_size: payload.icp_company_size || null,
      icp_stage: payload.icp_stage || null,
      icp_buyer_title: payload.icp_buyer_title || null,
      icp_user_title: payload.icp_user_title || null,
      icp_stack_tools: payload.icp_stack_tools || null,
      traction_arr: payload.traction_arr || null,
      traction_customers: payload.traction_customers || null,
    }, { onConflict: 'external_product_id,organisation_id' })
    .select('id')
    .single();

  if (endUserErr) {
    console.error(`[webhooks/pipeline-intake] end-user product insert failed:`, endUserErr);
    return NextResponse.json({ error: 'storage failed', detail: endUserErr.message }, { status: 500 });
  }

  const product = distributorProduct;

  if (productErr) {
    console.error(`[webhooks/pipeline-intake] product insert failed:`, productErr);
    return NextResponse.json({ error: 'storage failed', detail: productErr.message }, { status: 500 });
  }

  const channels: { distributor_channel_id: string | null; end_user_channel_id: string | null } = {
    distributor_channel_id: null,
    end_user_channel_id: null,
  };

  // §2a COMPLIANCE GATE: Regulated products skip distributor/end-user channels
  if (payload.regulated_flag) {
    console.log(`[webhooks/pipeline-intake] product=${payload.product_id} is regulated - routing to wholesale track`);

    // Create wholesale track channel instead
    const { data: wholesaleChannel, error: wholesaleErr } = await db
      .from('channels')
      .insert({
        organisation_id: organisationId,
        distributor_product_id: distributorProduct.id,
    end_user_product_id: endUserProduct.id,
        channel_type: 'wholesale_track',
        status: 'pending_compliance',
        config: {
          source: 'pipeline',
          compliance_status: 'awaiting_human_signoff',
          original_regulated_flag: payload.regulated_flag,
        },
      })
      .select('id')
      .single();

    if (wholesaleErr) {
      console.error(`[webhooks/pipeline-intake] wholesale channel insert failed:`, wholesaleErr);
      return NextResponse.json({ error: 'wholesale channel creation failed', detail: wholesaleErr.message }, { status: 500 });
    }

    channels.distributor_channel_id = wholesaleChannel.id as string;

    // Audit log for regulated product
    await db.from('audit_events').insert({
      organisation_id: organisationId,
      actor: 'webhook:pipeline-intake',
      action: 'product.received.regulated',
      resource_type: 'product',
      resource_id: product.id as string,
      payload: {
        external_product_id: payload.product_id,
        product_name: payload.product_name,
        channel_id: wholesaleChannel.id,
        intake_timestamp: payload.timestamp,
        routed_to: 'wholesale_track',
        compliance_status: 'awaiting_human_signoff',
      },
    });

    console.log(
      `[webhooks/pipeline-intake] stored product=${payload.product_id} name="${payload.product_name}" (regulated) channel=${wholesaleChannel.id}`,
    );

    return NextResponse.json({
      ok: true,
    distributor_product_id: distributorProduct.id,
    end_user_product_id: endUserProduct.id,
      channel_id: wholesaleChannel.id,
      channel_type: 'wholesale_track',
      status: 'pending_compliance',
      message: 'Regulated product routed to wholesale track (awaiting human sign-off)',
    });
  }

  // NON-REGULATED: Create channels for each product stream
  // Distributor product → distributor_outreach channel
  const { data: distributorChannel, error: distributorErr } = await db
    .from('channels')
    .insert({
      organisation_id: organisationId,
      product_id: distributorProduct.id,
      channel_type: 'distributor_outreach',
      status: 'active',
      config: {
        icp: payload.distributor_icp,
        pitch: payload.distributor_pitch,
        source: 'pipeline',
      },
    })
    .select('id')
    .single();

  if (distributorErr) {
    console.error(`[webhooks/pipeline-intake] distributor channel insert failed:`, distributorErr);
    return NextResponse.json({ error: 'channel creation failed', detail: distributorErr.message }, { status: 500 });
  }

  channels.distributor_channel_id = distributorChannel.id as string;

  // End-user product → end_user_feedback channel
  const { data: endUserChannel, error: endUserErr } = await db
    .from('channels')
    .insert({
      organisation_id: organisationId,
      product_id: endUserProduct.id,
      channel_type: 'end_user_feedback',
      status: 'active',
      config: {
        icp: payload.end_user_icp,
        pitch: 'Use this product and tell us how to make it better',
        source: 'pipeline',
        cta_destination: payload.cta_spec.destination,
      },
    })
    .select('id')
    .single();

  if (endUserErr) {
    console.error(`[webhooks/pipeline-intake] end-user channel insert failed:`, endUserErr);
    // Non-fatal - continue without end-user channel
    console.warn(`[webhooks/pipeline-intake] continuing without end-user channel for product=${payload.product_id}`);
  } else {
    channels.end_user_channel_id = endUserChannel.id as string;
  }

  // Audit log
  await db.from('audit_events').insert({
    organisation_id: organisationId,
    actor: 'webhook:pipeline-intake',
    action: 'product.received',
    resource_type: 'product',
    resource_id: product.id as string,
    payload: {
      external_product_id: payload.product_id,
      product_name: payload.product_name,
      distributor_channel_id: channels.distributor_channel_id,
      end_user_channel_id: channels.end_user_channel_id,
      intake_timestamp: payload.timestamp,
    },
  });

  console.log(
    `[webhooks/pipeline-intake] stored product=${payload.product_id} name="${payload.product_name}" distributor=${channels.distributor_channel_id} end_user=${channels.end_user_channel_id}`,
  );

  // §6 step 4: Return stream IDs to pipeline (needed for automated die path)
  return NextResponse.json({
    ok: true,
    distributor_product_id: distributorProduct.id,
    end_user_product_id: endUserProduct.id,
    distributor_channel_id: channels.distributor_channel_id,
    end_user_channel_id: channels.end_user_channel_id,
    message: 'Product received as dual-stream (distributor + end-user)',
  });
}
