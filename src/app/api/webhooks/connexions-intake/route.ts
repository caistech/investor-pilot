/**
 * POST /api/webhooks/connexions-intake
 *
 * Receives an `intake.completed` event from Connexions when a prospect
 * finishes the platform-trust-sprint-intake (or any future intake) that
 * was clicked through from an InvestorPilot outreach. Attaches the
 * captured answers to the partner record matching the `ref` UUID that
 * InvestorPilot embedded in the outreach CTA URL.
 *
 * Contract: docs/integrations/connexions-intake-webhook.md
 * Handoff:  docs/integrations/connexions-side-handoff.md
 *
 * Self-authenticating (HMAC-SHA256 of body using shared secret in
 * CONNEXIONS_INTAKE_WEBHOOK_SECRET). Middleware allowlists /api/webhooks/*
 * already, so no separate bypass needed.
 *
 * Idempotency: external_intake_id has a UNIQUE constraint; a duplicate
 * delivery returns 200 OK with `deduplicated: true` rather than erroring.
 * Critical so Connexions stops retrying on its second send rather than
 * pinging us forever.
 */

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

interface IntakePayload {
  intake_id?: string;
  ref?: string | null;
  src?: string | null;
  intake_slug?: string;
  completed_at?: string;
  prospect?: {
    name?: string | null;
    email?: string | null;
    company?: string | null;
    linkedin_url?: string | null;
  };
  answers?: Array<{ question_id?: string; question?: string; answer?: string }>;
  summary?: string;
  duration_seconds?: number;
}

function verifySignature(rawBody: string, signatureHeader: string | null): { ok: boolean; reason?: string } {
  if (!signatureHeader) return { ok: false, reason: 'missing X-Connexions-Signature' };
  const secret = process.env.CONNEXIONS_INTAKE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'CONNEXIONS_INTAKE_WEBHOOK_SECRET not configured on server' };

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
  // 1) Read raw body for signature verification. Must consume as text
  //    before parsing — JSON.parse changes whitespace and breaks HMAC.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-connexions-signature');

  const sigResult = verifySignature(rawBody, signatureHeader);
  if (!sigResult.ok) {
    console.warn(`[webhooks/connexions-intake] signature rejected: ${sigResult.reason}`);
    return NextResponse.json({ error: sigResult.reason || 'signature invalid' }, { status: 401 });
  }

  // 2) Parse JSON. If the body isn't valid JSON the signature wouldn't
  //    have verified, but defensive.
  let payload: IntakePayload;
  try {
    payload = JSON.parse(rawBody) as IntakePayload;
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 });
  }

  if (!payload.intake_id || typeof payload.intake_id !== 'string') {
    return NextResponse.json({ error: 'intake_id is required' }, { status: 400 });
  }

  const db = createServiceClient();

  // 3) Resolve `ref` to a partner. If the ref is a non-empty string AND
  //    a valid UUID-shape, look it up. Stale/deleted partner refs flow
  //    through as unattributed (partner_id = null) rather than erroring.
  //    Also fetch contact_linkedin here so we can backfill it below
  //    (rule #4) when the prospect provided one and the partner has none.
  let partnerId: string | null = null;
  let organisationId: string | null = null;
  let partnerContactLinkedin: string | null = null;
  const refLooksLikeUuid =
    typeof payload.ref === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.ref);

  if (refLooksLikeUuid) {
    const { data: partner } = await db
      .from('partners')
      .select('id, organisation_id, contact_linkedin')
      .eq('id', payload.ref!)
      .maybeSingle();
    if (partner) {
      partnerId = partner.id as string;
      organisationId = partner.organisation_id as string;
      partnerContactLinkedin = (partner.contact_linkedin as string) || null;
    }
  }

  // 4) Fallback: try to match by prospect email if ref didn't resolve.
  //    Useful for organic intakes from prospects we've already discovered
  //    but who landed via direct link (no ?ref). Email is a reasonable
  //    join key for contact-led traffic.
  if (!organisationId && payload.prospect?.email) {
    const { data: byEmail } = await db
      .from('partners')
      .select('id, organisation_id, contact_linkedin')
      .ilike('contact_email', payload.prospect.email)
      .limit(1)
      .maybeSingle();
    if (byEmail) {
      partnerId = byEmail.id as string;
      organisationId = byEmail.organisation_id as string;
      partnerContactLinkedin = (byEmail.contact_linkedin as string) || null;
    }
  }

  // 5) If we still don't have an org, we cannot store the row (RLS / FK
  //    requires organisation_id). Log and return 200 — Connexions
  //    shouldn't retry an unattributable intake. The response body
  //    tells the operator (via Connexions logs) what happened.
  if (!organisationId) {
    console.warn(
      `[webhooks/connexions-intake] cannot resolve organisation for intake_id=${payload.intake_id} ref=${payload.ref ?? 'null'} email=${payload.prospect?.email ?? 'null'} — storing as unattributed`,
    );
    // Even unattributable rows are worth keeping for audit/replay.
    // We'll attribute them to the first organisation we find — that's
    // wrong for multi-tenant but acceptable for v1 (one operator org).
    // TODO: better fallback when there are multiple tenants.
    const { data: firstOrg } = await db
      .from('organisations')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstOrg) {
      // Truly no orgs in the system — return 200 OK with attributed:false
      // so Connexions doesn't retry. Data is lost; this is a degenerate
      // case (fresh install with no orgs) that won't happen in prod.
      return NextResponse.json({ ok: true, attributed: false, reason: 'no_orgs_in_system' });
    }
    organisationId = firstOrg.id as string;
  }

  // 6) Insert. The UNIQUE index on external_intake_id handles dedup —
  //    a duplicate delivery raises code 23505 which we catch and return
  //    as a successful (deduplicated) response.
  const insertPayload = {
    organisation_id: organisationId,
    partner_id: partnerId,
    external_intake_id: payload.intake_id,
    source: 'connexions',
    intake_slug: payload.intake_slug || null,
    src_param: payload.src || null,
    completed_at: payload.completed_at || new Date().toISOString(),
    prospect_name: payload.prospect?.name || null,
    prospect_email: payload.prospect?.email || null,
    prospect_company: payload.prospect?.company || null,
    prospect_linkedin: payload.prospect?.linkedin_url || null,
    answers: payload.answers || null,
    summary: payload.summary || null,
    duration_seconds: typeof payload.duration_seconds === 'number' ? payload.duration_seconds : null,
    raw_payload: payload,
  };

  const { error: insertErr, data: inserted } = await db
    .from('intake_responses')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr) {
    // 23505 = unique_violation on external_intake_id — duplicate delivery,
    // already processed. Idempotent success.
    if ((insertErr as { code?: string }).code === '23505') {
      console.log(`[webhooks/connexions-intake] duplicate intake_id=${payload.intake_id} — deduplicated`);
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error(`[webhooks/connexions-intake] insert failed:`, insertErr);
    return NextResponse.json({ error: 'storage failed', detail: insertErr.message }, { status: 500 });
  }

  // 7) LinkedIn backfill on the partner record. Per the Connexions
  //    follow-up brief (docs/integrations/connexions-side-handoff.md
  //    section "What Connexions is sending"): the intake now optionally
  //    captures a LinkedIn URL. If the prospect provided one AND we
  //    matched them to a partner AND that partner has no
  //    contact_linkedin yet, write the URL onto the partner permanently
  //    so future renders can use the warm-vs-cold tier (network
  //    distance enrichment), the channel router (LinkedIn step becomes
  //    sendable), and the operator's manual triage from /prospects all
  //    benefit. Conservative: only fills the empty case — never
  //    overwrites an existing LinkedIn URL because the operator may
  //    have set it deliberately.
  const incomingLinkedin = payload.prospect?.linkedin_url || null;
  let backfilledPartnerLinkedin = false;
  if (partnerId && incomingLinkedin && !partnerContactLinkedin) {
    const { error: backfillErr } = await db
      .from('partners')
      .update({ contact_linkedin: incomingLinkedin })
      .eq('id', partnerId);
    if (!backfillErr) {
      backfilledPartnerLinkedin = true;
      console.log(`[webhooks/connexions-intake] backfilled partner ${partnerId} contact_linkedin from intake ${payload.intake_id}`);
    } else {
      console.warn(`[webhooks/connexions-intake] backfill failed for partner ${partnerId}:`, backfillErr.message);
    }
  }

  // 8) Audit log so the operator can see this intake landed.
  await db.from('audit_events').insert({
    organisation_id: organisationId,
    actor: 'webhook:connexions-intake',
    action: 'intake.received',
    resource_type: 'intake_response',
    resource_id: inserted!.id as string,
    payload: {
      external_intake_id: payload.intake_id,
      partner_id: partnerId,
      attributed: !!partnerId,
      intake_slug: payload.intake_slug,
      src: payload.src,
      prospect_email: payload.prospect?.email,
      backfilled_partner_linkedin: backfilledPartnerLinkedin,
    },
  });

  console.log(
    `[webhooks/connexions-intake] stored intake_id=${payload.intake_id} → ${inserted!.id} attributed=${!!partnerId}`,
  );

  return NextResponse.json({
    ok: true,
    intake_response_id: inserted!.id,
    attributed: !!partnerId,
    partner_id: partnerId,
  });
}
