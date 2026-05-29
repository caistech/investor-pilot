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

  // Store product in products table
  const { data: product, error: productErr } = await db
    .from('products')
    .upsert({
      organisation_id: organisationId,
      external_product_id: payload.product_id,
      name: payload.product_name,
      description: payload.description,
      landing_page_url: payload.landing_page_url,
      distributor_icp: payload.distributor_icp,
      distributor_pitch: payload.distributor_pitch,
      end_user_icp: payload.end_user_icp,
      friction: payload.friction,
      regulated_flag: payload.regulated_flag,
      cta_destination: payload.cta_spec.destination,
      cta_events: payload.cta_spec.events,
      validation_hard_gates_passed: payload.validation_summary.hard_gates_passed,
      validation_weighted_score: payload.validation_summary.weighted_score,
      validation_gates_ready: payload.validation_summary.gates_ready,
      intake_source: 'pipeline',
      intake_timestamp: payload.timestamp,
    }, { onConflict: 'external_product_id,organisation_id' })
    .select('id')
    .single();

  if (productErr) {
    console.error(`[webhooks/pipeline-intake] product insert failed:`, productErr);
    return NextResponse.json({ error: 'storage failed', detail: productErr.message }, { status: 500 });
  }

  // Create distributor outreach channel
  const { data: channel, error: channelErr } = await db
    .from('channels')
    .insert({
      organisation_id: organisationId,
      product_id: product.id,
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

  if (channelErr) {
    console.error(`[webhooks/pipeline-intake] channel insert failed:`, channelErr);
    return NextResponse.json({ error: 'channel creation failed', detail: channelErr.message }, { status: 500 });
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
      channel_id: channel.id,
      intake_timestamp: payload.timestamp,
    },
  });

  console.log(
    `[webhooks/pipeline-intake] stored product=${payload.product_id} name="${payload.product_name}" channel=${channel.id}`,
  );

  return NextResponse.json({
    ok: true,
    product_id: product.id,
    channel_id: channel.id,
    message: 'Product received and channel created',
  });
}
