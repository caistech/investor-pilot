/**
 * POST /api/webhooks/pipeline-intake
 *
 * Distributor-only intake. We deliberately DO NOT create an end-user product
 * here: the end-user side is B2C (students / karaoke users) with no B2B
 * discovery motion, so an end-user "product" in InvestorPilot just produced
 * empty, prospect-less rows. Demand is measured via distributor conversion.
 * (2026-05-31: removed the end-user product + end-user channel creation.)
 *
 * Duplicate-creation fix: external_product_id is derived from a STABLE slug of
 * product_name (not payload.product_id, which is regenerated each submission),
 * so re-submissions collide on the unique (external_product_id,
 * organisation_id) constraint and UPDATE the same distributor product instead
 * of stacking new ones.
 *
 * Path 2: maps the full ICP set the pipeline now sends — including
 * icp_partner_type (the top discovery steering signal), icp_buyer_title and
 * exclusions — so a pipeline submission produces a fully-onboarded product.
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
  icp_partner_type: string | null;
  icp_buyer_title: string | null;
  exclusions: string | null;
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

    // Pipeline's payload doesn't reliably include the nested objects this route
    // dereferences (cta_spec, validation_summary). Normalize them up front so a
    // missing object degrades gracefully instead of throwing a 500 mid-upsert.
    payload.cta_spec = {
      destination: payload.cta_spec?.destination ?? payload.landing_page_url ?? '',
      events: payload.cta_spec?.events ?? ['click'],
    };
    payload.validation_summary = {
      hard_gates_passed: payload.validation_summary?.hard_gates_passed ?? 0,
      weighted_score: payload.validation_summary?.weighted_score ?? 0,
      gates_ready: payload.validation_summary?.gates_ready ?? false,
    };

    console.log('[webhooks/pipeline-intake] POST: payload.product_name =', payload.product_name);
    console.log('[webhooks/pipeline-intake] POST: payload.submitter_email =', payload.submitter_email);

    // Field-presence diagnostics — logs which ICP fields actually arrived from
    // the pipeline, so an empty product can be traced to the SENDER (execute
    // route / empty admin validation row) rather than this receiver.
    console.log('[webhooks/pipeline-intake] POST: field presence =', JSON.stringify({
      core_mechanism: !!payload.core_mechanism,
      distributor_outcomes: !!payload.distributor_outcomes,
      icp_company_size: !!payload.icp_company_size,
      icp_stage: !!payload.icp_stage,
      icp_verticals: !!payload.icp_verticals,
      target_verticals: !!payload.target_verticals,
      icp_geography: !!payload.icp_geography,
      icp_partner_type: !!payload.icp_partner_type,
      icp_buyer_title: !!payload.icp_buyer_title,
      exclusions: !!payload.exclusions,
      one_pager_url: !!payload.one_pager_url,
      distributor_icp: !!payload.distributor_icp,
    }));

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

    // Stable base key so re-submissions of the same product COLLIDE on the
    // unique (external_product_id, organisation_id) constraint and UPDATE,
    // instead of inserting a fresh product every time. payload.product_id is
    // regenerated per submission — using it as the base was the
    // duplicate-creation bug. slugify(product_name) is stable.
    const stableBase = slugify(payload.product_name);
    const distributorProductId = `${stableBase}-distributor`;

    // ICP-verticals fallback: the sender may put the value under icp_verticals
    // OR target_verticals depending on payload version. Prefer the explicit
    // one, fall back, so the field lands populated either way.
    const icpVerticals = payload.icp_verticals || payload.target_verticals || null;

    console.log('[webhooks/pipeline-intake] POST: upserting distributor product');
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
        icp_verticals: icpVerticals,
        icp_company_size: payload.icp_company_size,
        icp_stage: payload.icp_stage,
        geography: payload.icp_geography,
        // Path 2 — ICP-targeting fields.
        icp_partner_type: payload.icp_partner_type || 'buyer',
        icp_buyer_title: payload.icp_buyer_title ?? null,
        exclusions: payload.exclusions ?? null,
        one_pager_url: payload.one_pager_url,
        pitch_deck_url: payload.pitch_deck_url,
        partner_types: 'distributor',
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

    // ─────────────────────────────────────────────────────────────────────
    // End-user product intentionally NOT created (2026-05-31 decision).
    // ─────────────────────────────────────────────────────────────────────

    const channels: { distributor_channel_id: string | null } = {
      distributor_channel_id: null,
    };

    console.log('[webhooks/pipeline-intake] POST: regulated_flag =', payload.regulated_flag);

    if (payload.regulated_flag) {
      console.log('[webhooks/pipeline-intake] POST: creating wholesale channel');
      const { data: wholesaleChannel, error: wholesaleErr } = await db
        .from('channels')
        .insert({
          organisation_id: organisationId,
          distributor_product_id: distributorProduct.id,
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
    } else {
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
    }

    // AUTO-START: distributor-only — pass null for the former end-user arg.
    const isDataComplete = checkDataCompleteness(payload);
    console.log('[webhooks/pipeline-intake] POST: data completeness check:', isDataComplete);

    const createdTimestamp = new Date().toISOString();
    sendProductCreatedEmail(email, payload.product_name, createdTimestamp).catch(console.error);

    if (isDataComplete) {
      console.log('[webhooks/pipeline-intake] POST: Starting auto-discovery (distributor only)');
      triggerAutoDiscovery(organisationId, distributorProduct.id, null, email, payload.product_name)
        .catch(err => console.error('[webhooks/pipeline-intake] auto-discovery error:', err));
    }

    console.log('[webhooks/pipeline-intake] POST: SUCCESS - returning response');
    return NextResponse.json({
      ok: true,
      organisation_id: organisationId,
      distributor_product_id: distributorProduct.id,
      distributor_channel_id: channels.distributor_channel_id,
    });

  } catch (error) {
    console.error('[webhooks/pipeline-intake] POST: UNHANDLED ERROR', error);
    return NextResponse.json({ error: 'internal error', detail: String(error) }, { status: 500 });
  }
}

function checkDataCompleteness(payload: PipelineProductPayload): boolean {
  // Distributor-only completeness — end-user fields no longer gate auto-start.
  const required = [
    payload.product_pitch,
    payload.description,
    payload.distributor_icp,
    payload.core_mechanism,
    payload.distributor_outcomes,
    payload.icp_company_size,
    payload.icp_stage,
    payload.icp_verticals || payload.target_verticals,
    payload.partner_types,
  ];

  const filled = required.filter(v => v && v.trim().length > 0);
  console.log('[webhooks/pipeline-intake] completeness:', filled.length, '/', required.length);
  return filled.length >= 6;
}