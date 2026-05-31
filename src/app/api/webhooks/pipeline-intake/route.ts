/**
 * POST /api/webhooks/pipeline-intake
 */

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils';
import { triggerAutoDiscovery, sendProductCreatedEmail } from '@/lib/pipeline/auto-discovery';

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
  product_pitch: string | null;
  distributor_outcomes: string | null;
  end_user_outcomes: string | null;
  core_mechanism: string | null;
  target_verticals: string | null;
  icp_company_size: string | null;
  icp_stage: string | null;
  icp_verticals: string | null;
  icp_geography: string | null;
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
    safeEqual = timingSafeEqual(Buffer.from(expected), Buffer.from(computed));
  } catch {
    return { ok: false, reason: 'timing-safe-equal failed' };
  }

  return { ok: safeEqual, reason: safeEqual ? undefined : 'signature mismatch' };
}

function createServiceClientFromEnv() {
  return createServiceClient();
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('x-pipeline-signature');
    const verifyResult = verifySignature(rawBody, signatureHeader);

    console.log('[webhooks/pipeline-intake] POST: verifyResult =', verifyResult);

    if (!verifyResult.ok) {
      return NextResponse.json({ error: verifyResult.reason }, { status: 401 });
    }

    const payload: PipelineProductPayload = JSON.parse(rawBody);

    // Pipeline doesn't always send cta_spec (or sends it without a destination).
    // Fall back to the landing page URL so the upserts and channel configs below
    // never dereference an undefined cta_spec — this was the source of the
    // "Cannot read properties of undefined (reading 'destination')" 500.
    if (!payload.cta_spec || typeof payload.cta_spec.destination !== 'string') {
      payload.cta_spec = {
        destination: payload.landing_page_url ?? '',
        events: payload.cta_spec?.events ?? ['click'],
      };
      console.warn('[webhooks/pipeline-intake] POST: cta_spec missing/invalid — defaulted to landing_page_url');
    }

    console.log('[webhooks/pipeline-intake] POST: payload.product_name =', payload.product_name);
    console.log('[webhooks/pipeline-intake] POST: payload.submitter_email =', payload.submitter_email);

    const email = payload.submitter_email.toLowerCase();
    console.log('[webhooks/pipeline-intake] POST: email normalized =', email);

    const db = createServiceClientFromEnv();

    console.log('[webhooks/pipeline-intake] POST: checking for existing membership');
    const { data: memberOrg, error: memberErr } = await db
      .from('memberships')
      .select('organisation_id, role')
      .eq('user_email', email)
      .maybeSingle();

    console.log('[webhooks/pipeline-intake] POST: memberErr =', memberErr);
    console.log('[webhooks/pipeline-intake] POST: memberOrg =', JSON.stringify(memberOrg));

    let organisationId: string;

    // Use email-based lookup since Pipeline and InvestorPilot have different Supabase instances
    if (memberOrg) {
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
        const { data: newOrg, error: orgErr } = await db
          .from('organisations')
          .insert({ name: `${email}'s Org` })
          .select('id')
          .single();

        if (orgErr) {
          console.error('[webhooks/pipeline-intake] POST: org creation failed', orgErr);
          return NextResponse.json({ error: 'org creation failed', detail: orgErr.message }, { status: 500 });
        }

        organisationId = newOrg.id;

        console.log('[webhooks/pipeline-intake] POST: creating profile');
        const { data: newProfile, error: profileCreateErr } = await db
          .from('profiles')
          .insert({
            id: crypto.randomUUID(),
            email,
            active_organisation_id: organisationId,
          })
          .select('id')
          .single();

        if (profileCreateErr) {
          console.error('[webhooks/pipeline-intake] POST: profile creation failed', profileCreateErr);
        } else {
          console.log('[webhooks/pipeline-intake] POST: creating owner membership');
          await db.from('memberships').insert({
            user_id: newProfile.id,
            organisation_id: organisationId,
            role: 'owner',
          });
        }
      }
    }

    console.log('[webhooks/pipeline-intake] POST: FINAL org id =', organisationId);

    const distributorProductId = `${payload.product_id}-distributor`;
    const endUserProductId = `${payload.product_id}-enduser`;

    console.log('[webhooks/pipeline-intake] POST: inserting distributor product');
    const { data: distributorProduct, error: distributorErr } = await db
      .from('products')
      .upsert({
        organisation_id: organisationId,
        external_product_id: distributorProductId,
        name: `${payload.product_name} (Distributor)`,
        one_sentence_description: payload.description,
        product_pitch: payload.product_pitch,
        landing_page_url: payload.cta_spec.destination,
        distributor_icp: payload.distributor_icp,
        distributor_pitch: payload.distributor_pitch,
        end_user_icp: null,
        friction: payload.friction,
        core_mechanism: payload.core_mechanism,
        customer_outcomes: payload.distributor_outcomes,
        icp_verticals: payload.target_verticals,
        icp_company_size: payload.icp_company_size,
        icp_stage: payload.icp_stage,
        geography: payload.icp_geography,
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
        product_pitch: payload.product_pitch,
        landing_page_url: payload.cta_spec.destination,
        distributor_icp: null,
        distributor_pitch: null,
        end_user_icp: payload.end_user_icp,
        friction: payload.friction,
        customer_outcomes: payload.end_user_outcomes,
        core_mechanism: payload.core_mechanism,
        icp_verticals: payload.target_verticals,
        icp_company_size: payload.icp_company_size,
        icp_stage: payload.icp_stage,
        geography: payload.icp_geography,
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

      if (!wholesaleErr) {
        channels.distributor_channel_id = wholesaleChannel.id as string;
      }
    }

    if (!payload.regulated_flag) {
      console.log('[webhooks/pipeline-intake] POST: creating distributor_outreach channel');
      const { data: distributorChannel, error: distributorChannelErr } = await db
        .from('channels')
        .insert({
          organisation_id: organisationId,
          distributor_product_id: distributorProduct.id,
          channel_type: 'distributor_outreach',
          status: 'active',
          config: {
            icp: payload.distributor_icp,
            pitch: payload.product_pitch || payload.description,
            source: 'pipeline',
            cta_destination: payload.cta_spec.destination,
            cta_events: payload.cta_spec.events,
          },
        })
        .select('id')
        .single();

      console.log('[webhooks/pipeline-intake] POST: distributorChannelErr =', distributorChannelErr);

      if (!distributorChannelErr) {
        channels.distributor_channel_id = distributorChannel.id as string;
      }

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
    }

    // AUTO-START: If data is complete, trigger discovery + sequence generation
    const isDataComplete = checkDataCompleteness(payload);
    console.log('[webhooks/pipeline-intake] POST: data completeness check:', isDataComplete);

    // Send product created email immediately
    const createdTimestamp = new Date().toISOString();
    sendProductCreatedEmail(email, payload.product_name, createdTimestamp).catch(console.error);

    if (isDataComplete) {
      console.log('[webhooks/pipeline-intake] POST: Starting auto-discovery for products');

      // Fire-and-forget: trigger discovery jobs for both products
      triggerAutoDiscovery(organisationId, distributorProduct.id, endUserProduct.id, email, payload.product_name)
        .catch(err => console.error('[webhooks/pipeline-intake] auto-discovery error:', err));
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

function checkDataCompleteness(payload: PipelineProductPayload): boolean {
  const required = [
    payload.product_pitch,
    payload.description,
    payload.distributor_icp,
    payload.end_user_icp,
    payload.core_mechanism,
    payload.distributor_outcomes,
    payload.end_user_outcomes,
    payload.icp_company_size,
    payload.icp_stage,
    payload.icp_verticals,
    payload.partner_types,
  ];

  const filled = required.filter(v => v && v.trim().length > 0);
  console.log('[webhooks/pipeline-intake] completeness:', filled.length, '/', required.length);
  return filled.length >= 8;
}