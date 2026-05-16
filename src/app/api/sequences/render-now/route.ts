/**
 * POST /api/sequences/render-now
 *
 * Operator-triggered render of the FIRST pending sequence_step for each
 * selected partner. Same code path as the 15-minute cron — just invoked
 * synchronously so the operator doesn't have to wait.
 *
 * Diagnostic-first design: every response includes a per-partner state
 * map so the Prospects page can explain exactly what landed where (vs
 * the previous "0 rendered, no idea why" experience). The route also
 * short-circuits when the partner's first step is ALREADY rendered
 * (status queued_for_approval / compliance_blocked / sent / replied) —
 * no point burning Claude tokens re-rendering something that's just
 * sitting in Approvals already.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Returns (always 200 unless auth fails):
 *   {
 *     ok: true,
 *     counts: { queued, already_rendered, blocked, failed, no_pending_step, skipped_no_channel },
 *     hint: string,
 *     partner_states: [{ partner_id, first_step_status, outbound_message_id? }],
 *     runner_result?: { ... }     // present when we actually invoked runSequencer
 *   }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { runSequencer } from '@/lib/sequencer/runner';

export const maxDuration = 60;

// Operator-triggered: small batch only. Larger batches blow Vercel's 60s
// function ceiling because runSequencer is sequential — each partner's
// first step is its own Claude call. Anything >4 should wait for the
// 15-min cron tick instead.
const MAX_PARTNERS_PER_REQUEST = 4;

// Statuses where the step has already produced an outbound_message —
// re-rendering is wasteful and produces dupes. If the step is in any of
// these, render-now skips it and reports already_rendered.
const ALREADY_RENDERED = new Set([
  'queued_for_approval',
  'compliance_blocked',
  'sent',
  'replied',
  'failed',
]);

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const partnerIds: string[] = Array.isArray(body.partner_ids) ? body.partner_ids : [];

  if (partnerIds.length === 0) {
    return NextResponse.json({ error: 'partner_ids (non-empty array) required' }, { status: 400 });
  }
  if (partnerIds.length > MAX_PARTNERS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Batch size ${partnerIds.length} exceeds limit ${MAX_PARTNERS_PER_REQUEST}. Render in smaller chunks or wait for the 15-min cron.`,
      },
      { status: 400 },
    );
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Defence-in-depth: only render steps that belong to this org, even if
  // a malicious client passes another org's partner_ids.
  const { data: orgPartners } = await db
    .from('partners')
    .select('id')
    .in('id', partnerIds)
    .eq('organisation_id', profile.organisation_id);

  const allowedIds = (orgPartners || []).map((p) => p.id as string);
  if (allowedIds.length === 0) {
    return NextResponse.json(
      { error: 'None of the supplied partners belong to your organisation' },
      { status: 403 },
    );
  }

  // Fetch the lowest-index step per partner. The renderer always works
  // through step_index 1 first, so that's the one the operator is
  // implicitly asking about when they click "3. Render & Queue". Pull
  // status + outbound_message_id so we can report the current state
  // without re-rendering.
  const { data: existingSteps } = await db
    .from('sequence_steps')
    .select('id, partner_id, status, step_index, outbound_message_id')
    .in('partner_id', allowedIds)
    .eq('organisation_id', profile.organisation_id)
    .order('step_index', { ascending: true });

  type StepRow = { id: string; partner_id: string; status: string; step_index: number; outbound_message_id: string | null };
  const firstStepByPartner = new Map<string, StepRow>();
  for (const s of (existingSteps || []) as StepRow[]) {
    if (!firstStepByPartner.has(s.partner_id)) {
      firstStepByPartner.set(s.partner_id, s);
    }
  }

  // Partition partners by what needs doing.
  const noStepIds: string[] = [];      // never assigned to a sequence
  const alreadyDoneIds: string[] = []; // step exists but already rendered
  const needsRenderIds: string[] = []; // step is pending

  for (const pid of allowedIds) {
    const step = firstStepByPartner.get(pid);
    if (!step) {
      noStepIds.push(pid);
    } else if (ALREADY_RENDERED.has(step.status)) {
      alreadyDoneIds.push(pid);
    } else {
      needsRenderIds.push(pid);
    }
  }

  // Short-circuit: nothing to render means no Claude calls — return
  // immediately so the operator gets a clear answer instead of timing
  // out.
  if (needsRenderIds.length === 0) {
    const counts = {
      queued: 0,
      already_rendered: alreadyDoneIds.length,
      no_pending_step: noStepIds.length,
      blocked: 0,
      failed: 0,
      skipped_no_channel: 0,
    };
    const hint = noStepIds.length === allowedIds.length
      ? 'None of the selected partners have a sequence assigned. Click "2. Assign Sequence" first.'
      : alreadyDoneIds.length === allowedIds.length
        ? 'All selected partners already have a rendered first message. Check Approvals — or the prospect detail page if Approvals is empty (compliance may have blocked them).'
        : 'Mixed state — some partners have no sequence yet, others are already rendered. Check the detail page per prospect.';
    return NextResponse.json({
      ok: true,
      counts,
      hint,
      partner_states: stateMap(allowedIds, firstStepByPartner),
    });
  }

  // Render only the partners with pending steps. Hard-cap total partners
  // here so the loop stays inside the 60s function ceiling even on a
  // slow-latency day.
  let runnerResult: unknown = null;
  let runnerError: string | null = null;
  try {
    const runnerResponse = await runSequencer({
      partnerIds: needsRenderIds,
      ignoreSchedule: true,
      organisationId: profile.organisation_id,
      skipWarmupTick: true,
      // 4-wide parallelism. With MAX_PARTNERS_PER_REQUEST=4, that's the
      // whole batch in a single chunk → total time ≈ max(step) ≈ 12-15s
      // instead of sum(step) ≈ 60s+ which was blowing Vercel's ceiling.
      concurrency: 4,
    });
    // runSequencer returns a NextResponse — unwrap to inspect counts.
    runnerResult = await runnerResponse.json();
  } catch (err) {
    // Includes timeout, network, parsing errors — anything that would
    // previously have surfaced as "Unexpected token 'A'" in the client.
    runnerError = err instanceof Error ? err.message : String(err);
  }

  // Re-fetch step states post-run so the response reflects the new truth.
  const { data: postSteps } = await db
    .from('sequence_steps')
    .select('id, partner_id, status, step_index, outbound_message_id')
    .in('partner_id', allowedIds)
    .eq('organisation_id', profile.organisation_id)
    .order('step_index', { ascending: true });

  const postFirstByPartner = new Map<string, StepRow>();
  for (const s of (postSteps || []) as StepRow[]) {
    if (!postFirstByPartner.has(s.partner_id)) postFirstByPartner.set(s.partner_id, s);
  }

  const counts = {
    queued: 0,
    already_rendered: alreadyDoneIds.length,
    no_pending_step: noStepIds.length,
    blocked: 0,
    failed: 0,
    skipped_no_channel: 0,
  };
  for (const pid of needsRenderIds) {
    const post = postFirstByPartner.get(pid);
    if (!post) {
      counts.failed += 1;
      continue;
    }
    if (post.status === 'queued_for_approval') counts.queued += 1;
    else if (post.status === 'compliance_blocked') counts.blocked += 1;
    else if (post.status === 'failed') counts.failed += 1;
    else if (post.status === 'pending') counts.skipped_no_channel += 1; // still pending after render attempt → no channel
    else counts.failed += 1;
  }

  // Pull the actual block reasons for blocked steps from audit_events so
  // the operator sees WHY a partner went silent (the most common reason
  // is "No discovery evidence on partner" — they need to re-enrich, not
  // edit the message). Without this, the UI just said "blocked by
  // compliance" which sent operators hunting for forbidden terms that
  // weren't the actual cause.
  const blockedStepIds = (postSteps || [])
    .filter((s) => s.status === 'compliance_blocked')
    .map((s) => s.id as string);

  const blockReasonsByPartner = new Map<string, string>();
  if (blockedStepIds.length > 0) {
    const { data: auditRows } = await db
      .from('audit_events')
      .select('resource_id, payload, created_at')
      .eq('organisation_id', profile.organisation_id)
      .eq('action', 'sequence.render_blocked')
      .in('resource_id', blockedStepIds)
      .order('created_at', { ascending: false });
    const stepToPartner = new Map((postSteps || []).map((s) => [s.id as string, s.partner_id as string]));
    for (const row of auditRows || []) {
      const partnerId = stepToPartner.get(row.resource_id as string);
      if (!partnerId) continue;
      if (blockReasonsByPartner.has(partnerId)) continue; // first reason wins
      const payload = (row.payload as { reason?: string; blocker?: string } | null) ?? {};
      const reason = payload.reason || payload.blocker || 'compliance';
      blockReasonsByPartner.set(partnerId, reason);
    }
  }

  // Distinguish "no evidence" blocks from compliance-flag blocks because
  // the remediation is different: no-evidence → re-enrich, compliance
  // flag → edit the body.
  const noEvidenceCount = Array.from(blockReasonsByPartner.values()).filter((r) => /no discovery evidence|no_credit_signal/i.test(r)).length;
  const complianceFlagCount = counts.blocked - noEvidenceCount;

  const blockedLine = counts.blocked === 0
    ? ''
    : noEvidenceCount > 0 && complianceFlagCount === 0
      ? ` ${noEvidenceCount} blocked because the partner has no Brave/LinkedIn evidence yet — click "Re-enrich evidence" to fix.`
      : noEvidenceCount === 0 && complianceFlagCount > 0
        ? ` ${complianceFlagCount} blocked by compliance regex — open prospect detail to see flagged terms.`
        : ` ${counts.blocked} blocked (${noEvidenceCount} no-evidence, ${complianceFlagCount} compliance) — re-enrich the no-evidence ones first.`;

  const hint = runnerError
    ? `Renderer threw before finishing: ${runnerError}`
    : counts.queued > 0
      ? `${counts.queued} message${counts.queued === 1 ? '' : 's'} ready for review in Approvals.${blockedLine}`
      : counts.blocked > 0
        ? blockedLine.trim()
        : counts.skipped_no_channel > 0
          ? `${counts.skipped_no_channel} skipped — Step 1 needs an active LinkedIn channel. Connect one in /channels.`
          : counts.failed > 0
            ? `${counts.failed} failed — check the prospect detail page for the per-step error.`
            : 'No state change. The cron may already be processing these — try Approvals in 30s.';

  return NextResponse.json({
    ok: true,
    counts,
    hint,
    partner_states: stateMap(allowedIds, postFirstByPartner),
    runner_result: runnerResult,
    runner_error: runnerError,
  });
}

function stateMap(
  partnerIds: string[],
  byPartner: Map<string, { id: string; status: string; outbound_message_id: string | null }>,
) {
  return partnerIds.map((pid) => {
    const step = byPartner.get(pid);
    return step
      ? { partner_id: pid, first_step_status: step.status, outbound_message_id: step.outbound_message_id }
      : { partner_id: pid, first_step_status: 'none', outbound_message_id: null };
  });
}
