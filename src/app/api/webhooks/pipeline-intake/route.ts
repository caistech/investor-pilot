/**
 * POST /api/webhooks/pipeline-intake
 */

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils';

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
  icp_company_size: string | null;
  icp_stage: string | null;
  icp_verticals: string | null;
  one_pager_url: string | null;
  pitch_deck_url: string | null;
  partner_types: string;
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
  submitter_email: string;
}

function verifySignature(rawBody: string, signatureHeader: string | null): { ok: boolean; reason?: string } {
  console.log('[webhooks/pipeline-intake] verifySignature: START');
  if (!signatureHeader) return { ok: false, reason: 'missing X-Pipeline-Signature' };
  const secret = process.env.PIPELINE_INTAKE_WEBHOOK_SECRET;
  console.log('[webhooks/pipeline-intake] verifySignature: secret exists =', !!secret);
  if (!secret) return { ok: false, reason: 'PIPELINE_INTAKE_WEBHOOK_SECRET not configured' };

  const match = signatureHeader.match(/^sha256=([a-f0-9]+)$/i);
  if (!match) return { ok: false, reason: 'signature header must be "sha256=<hex>"' };

  const expected = match[1].toLowerCase();
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (expected.length !== computed.length) return { ok: false, reason: 'signature length mismatch' };

  let safeEqual = false;
  try {
    safeEqual = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(computed, 'hex'));
  } catch (e) {
    console.error('[webhooks/pipeline-intake] verifySignature: timingSafeEqual error', e);
    return { ok: false, reason: 'signature parse failed' };
  }
  console.log('[webhooks/pipeline-intake] verifySignature: result =', safeEqual);
  return safeEqual ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

export async function POST(request: Request) {
  console.log('[webhooks/pipeline-intake] POST: ENTRY');
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch (e) {
    console.error('[webhooks/pipeline-intake] POST: failed to read body', e);
    return NextResponse.json({ error: 'failed to read body' }, { status: 500 });
  }
  console.log('[webhooks/pipeline-intake] POST: body length =', rawBody.length);

    const signatureHeader = request.headers.get('x-pipeline-signature');
    console.log('[webhooks/pipeline-intake] POST: signature present =', !!signatureHeader);

    console.log('[webhooks/pipeline-intake] POST: calling verifySignature');
    const sigResult = verifySignature(rawBody, signatureHeader);
    console.log('[webhooks/pipeline-intake] POST: sigResult =', sigResult);

    if (!sigResult.ok) {
      console.warn('[webhooks/pipeline-intake] POST: signature rejected', sigResult.reason);
      return NextResponse.json({ error: sigResult.reason || 'signature invalid' }, { status: 401 });
    }

    console.log('[webhooks/pipeline-intake] POST: parsing JSON');
    let payload: PipelineProductPayload;
    try {
      payload = JSON.parse(rawBody) as PipelineProductPayload;
      console.log('[webhooks/pipeline-intake] POST: parsed payload.product_id =', payload.product_id);
    } catch (e) {
      console.error('[webhooks/pipeline-intake] POST: JSON parse error', e);
      return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 });
    }

    if (!payload.product_id || !payload.product_name) {
      console.warn('[webhooks/pipeline-intake] POST: missing required fields');
      return NextResponse.json({ error: 'product_id and product_name are required' }, { status: 400 });
    }

    if (!payload.submitter_email) {
      console.warn('[webhooks/pipeline-intake] POST: missing submitter_email');
      return NextResponse.json({ error: 'submitter_email is required for security verification' }, { status: 400 });
    }

    payload.cta_spec = payload.cta_spec || { destination: payload.landing_page_url, events: ['click'] };
    payload.cta_spec.destination = payload.cta_spec.destination || payload.landing_page_url;
    payload.regulated_flag = payload.regulated_flag || false;
    payload.validation_summary = payload.validation_summary || { hard_gates_passed: 0, weighted_score: 0, gates_ready: false };
    payload.target_verticals = payload.target_verticals || null;
    payload.distributor_pitch = payload.distributor_pitch || null;
    payload.customer_outcomes = payload.customer_outcomes || null;
    payload.core_mechanism = payload.core_mechanism || null;

    try {

    console.log('[webhooks/pipeline-intake] POST: creating service client');
    const db = createServiceClient();
    console.log('[webhooks/pipeline-intake] POST: service client created');

    const email = payload.submitter_email.toLowerCase();
    console.log('[webhooks/pipeline-intake] POST: email =', email);
    console.log('[webhooks/pipeline-intake] POST: payload.product_id =', payload.product_id);

    console.log('[webhooks/pipeline-intake] POST: checking memberships');
    const { data: memberOrg, error: memberErr } = await db
      .from('memberships')
      .select('organisation_id, profiles!inner(email)')
      .eq('profiles.email', email)
      .limit(1)
      .maybeSingle();

    console.log('[webhooks/pipeline-intake] POST: memberErr =', memberErr);
    console.log('[webhooks/pipeline-intake] POST: memberOrg =', JSON.stringify(memberOrg));

    let organisationId: string;

    // If Pipeline passed organisation_id directly, use it
    if (payload.submitter_organisation_id) {
      organisationId = payload.submitter_organisation_id;
      console.log('[webhooks/pipeline-intake] POST: using org from Pipeline:', organisationId);
    } else if (memberOrg) {
      organisationId = memberOrg.organisation_id as string;
      console.log('[webhooks/pipeline-intake] POST: existing member org =', organisationId);
    } else {
      console.log('[webhooks/pipeline-intake] POST: checking profiles');
      const { data: existingProfile, error: profileErr } = await db
        .from('profiles')
        .select('id, active_organisation_id')
        .eq('email', email)
        .maybeSingle();

      console.log('[webhooks/pipeline-intake] POST: profileErr =', profileErr);
      console.log('[webhooks/pipeline-intake] POST: existingProfile =', existingProfile);

      if (existingProfile?.active_organisation_id) {
        organisationId = existingProfile.active_organisation_id;
        console.log('[webhooks/pipeline-intake] POST: creating membership for profile');
        await db.from('memberships').insert({
          user_id: existingProfile.id,
          organisation_id: organisationId,
          role: 'member',
        });
      } else {
        console.log('[webhooks/pipeline-intake] POST: creating new org');
        const orgName = payload.product_name.split(' ').slice(0, 2).join(' ') + ' Team';
        const orgSlug = slugify(orgName) + '-' + Date.now().toString(36);
        
        console.log('[webhooks/pipeline-intake] POST: inserting org', { orgName, orgSlug });
        const { data: newOrg, error: orgErr } = await db
          .from('organisations')
          .insert({ name: orgName, slug: orgSlug })
          .select('id')
          .single();

        console.log('[webhooks/pipeline-intake] POST: orgErr =', orgErr);
        console.log('[webhooks/pipeline-intake] POST: newOrg =', newOrg);

        if (!newOrg || orgErr) {
          console.error('[webhooks/pipeline-intake] POST: failed to create org', orgErr);
          return NextResponse.json({ error: 'failed to create organisation' }, { status: 500 });
        }

        organisationId = newOrg.id;
        console.log('[webhooks/pipeline-intake] POST: created org id =', organisationId);

        console.log('[webhooks/pipeline-intake] POST: creating profile');
        const { data: newProfile, error: profileCreateErr } = await db
          .from('profiles')
          .insert({
            id: crypto.randomUUID(),
            email,
            organisation_id: organisationId,
            active_organisation_id: organisationId,
            role: 'owner',
          })
          .select('id')
          .single();

        console.log('[webhooks/pipeline-intake] POST: profileCreateErr =', profileCreateErr);
        console.log('[webhooks/pipeline-intake] POST: newProfile =', newProfile);

        if (newProfile) {
          console.log('[webhooks/pipeline-intake] POST: creating membership for new profile');
          await db.from('memberships').insert({
            user_id: newProfile.id,
            organisation_id: organisationId,
            role: 'owner',
          });
        }
      }
    }

    console.log('[webhooks/pipeline-intake] POST: org resolved =', organisationId);

    // Create products
    const distributorProductId = `${payload.product_id}-distributor`;
    const endUserProductId = `${payload.product_id}-end-user`;

    console.log('[webhooks/pipeline-intake] POST: inserting distributor product');
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
        icp_company_size: payload.icp_company_size,
        icp_stage: payload.icp_stage,
        one_pager_url: payload.one_pager_url,
        pitch_deck_url: payload.pitch_deck_url,
        partner_types: payload.partner_types,
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

    console.log('[webhooks/pipeline-intake] POST: distributorErr =', distributorErr);
    console.log('[webhooks/pipeline-intake] POST: distributorProduct =', distributorProduct);

    if (distributorErr) {
      console.error('[webhooks/pipeline-intake] POST: distributor product failed', distributorErr);
      return NextResponse.json({ error: 'storage failed', detail: distributorErr.message }, { status: 500 });
    }

    console.log('[webhooks/pipeline-intake] POST: inserting end-user product');
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
        icp_company_size: payload.icp_company_size,
        icp_stage: payload.icp_stage,
        one_pager_url: payload.one_pager_url,
        pitch_deck_url: payload.pitch_deck_url,
        partner_types: payload.partner_types,
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

    console.log('[webhooks/pipeline-intake] POST: endUserErr =', endUserErr);

    if (endUserErr) {
      console.error('[webhooks/pipeline-intake] POST: end-user product failed', endUserErr);
      return NextResponse.json({ error: 'storage failed', detail: endUserErr.message }, { status: 500 });
    }

    const product = distributorProduct;

    const channels: { distributor_channel_id: string | null; end_user_channel_id: string | null } = {
      distributor_channel_id: null,
      end_user_channel_id: null,
    };

    console.log('[webhooks/pipeline-intake] POST: regulated_flag =', payload.regulated_flag);

    if (payload.regulated_flag) {
      console.log('[webhooks/pipeline-intake] POST: creating wholesale channel');
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
          },
        })
        .select('id')
        .single();

      console.log('[webhooks/pipeline-intake] POST: wholesaleErr =', wholesaleErr);

      if (wholesaleErr) {
        console.error('[webhooks/pipeline-intake] POST: wholesale channel failed', wholesaleErr);
        return NextResponse.json({ error: 'wholesale channel creation failed', detail: wholesaleErr.message }, { status: 500 });
      }

      channels.distributor_channel_id = wholesaleChannel.id as string;

      return NextResponse.json({
        ok: true,
        distributor_product_id: distributorProduct.id,
        end_user_product_id: endUserProduct.id,
        channel_id: wholesaleChannel.id,
        channel_type: 'wholesale_track',
        status: 'pending_compliance',
      });
    }

    console.log('[webhooks/pipeline-intake] POST: creating distributor channel');
    const { data: distributorChannel, error: distributorChannelErr } = await db
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

    console.log('[webhooks/pipeline-intake] POST: distributorChannelErr =', distributorChannelErr);

    if (distributorChannelErr) {
      console.error('[webhooks/pipeline-intake] POST: distributor channel failed', distributorChannelErr);
      return NextResponse.json({ error: 'channel creation failed', detail: distributorChannelErr.message }, { status: 500 });
    }

    channels.distributor_channel_id = distributorChannel.id as string;

    console.log('[webhooks/pipeline-intake] POST: creating end-user channel');
    const { data: endUserChannel, error: endUserChannelErr } = await db
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

    console.log('[webhooks/pipeline-intake] POST: endUserChannelErr =', endUserChannelErr);

    if (!endUserChannelErr) {
      channels.end_user_channel_id = endUserChannel.id as string;
    }

    console.log('[webhooks/pipeline-intake] POST: SUCCESS - returning response');
    console.log('[webhooks/pipeline-intake] POST: FINAL org_id =', organisationId);
    console.log('[webhooks/pipeline-intake] POST: FINAL distributor_product =', distributorProduct.id);
    return NextResponse.json({
      ok: true,
      organisation_id: organisationId,
      distributor_product_id: distributorProduct.id,
      end_user_product_id: endUserProduct.id,
      distributor_channel_id: channels.distributor_channel_id,
      end_user_channel_id: channels.end_user_channel_id,
    });

  } catch (error) {
    console.error('[webhooks/pipeline-intake] POST: UNHANDLED ERROR', error);
    return NextResponse.json({ error: 'internal error', detail: String(error) }, { status: 500 });
  }
}
