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

// Operator-triggered batch cap. Math: runSequencer runs 4-wide
// concurrency, each partner ≈ 12s for the Claude fit-signal call,
// + ~8s fixed overhead (auth, lookups, audit writes). 8 partners =
// 2 chunks of 4 = ~24s + overhead = ~32s, well inside Vercel's 60s
// ceiling. Bumped from 4 → 8 once the 4-wide parallelism shipped
// — the 4-cap was set when the loop was sequential and each partner
// added ~12s of wall time.
const MAX_PARTNERS_PER_REQUEST = 8;

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
  // a malicious client passes another org's partner_ids. Pull display +
  // evidence-availability fields so the outcome cards can say WHAT we
  // had to work with per partner.
  const { data: orgPartners } = await db
    .from('partners')
    .select('id, company_name, contact_name, contact_linkedin, evidence_enriched_at, profile_recent_posts, firm_recent_news, firm_named_deals, last_session_notes, category, source, network_distance')
    .in('id', partnerIds)
    .eq('organisation_id', profile.organisation_id);

  type PartnerRow = {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_linkedin: string | null;
    evidence_enriched_at: string | null;
    profile_recent_posts: Array<unknown> | null;
    firm_recent_news: Array<unknown> | null;
    firm_named_deals: Array<unknown> | null;
    last_session_notes: string | null;
    category: string | null;
    source: string | null;
    network_distance: string | null;
  };
  const partnerById = new Map<string, PartnerRow>(((orgPartners || []) as PartnerRow[]).map((p) => [p.id, p]));
  const allowedIds = Array.from(partnerById.keys());
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

  // Bucket EVERY selected partner (not just the ones we just rendered)
  // by their current first-step status. Earlier version only counted
  // needsRenderIds, which meant a batch of "3 already in compliance_blocked
  // + 1 just-failed" reported as "3 already done, 1 failed" — true but
  // not actionable. The operator needs to know the 3 are blocked too.
  const counts = {
    queued: 0,
    blocked: 0,
    failed: 0,
    skipped_no_channel: 0,
    sent_or_replied: 0,
    no_pending_step: noStepIds.length,
    // Kept for backwards-compatible client-side display.
    already_rendered: alreadyDoneIds.length,
  };
  for (const pid of allowedIds) {
    const post = postFirstByPartner.get(pid);
    if (!post) continue; // no step at all (noStepIds covered above)
    switch (post.status) {
      case 'queued_for_approval': counts.queued += 1; break;
      case 'compliance_blocked':  counts.blocked += 1; break;
      case 'failed':              counts.failed += 1; break;
      case 'sent':
      case 'replied':             counts.sent_or_replied += 1; break;
      case 'pending':
        // Pending after a render attempt = renderer punted (no channel).
        // For partners we never tried to render this run, pending is
        // genuinely pending — but in render-now's contract every selected
        // partner gets attempted, so treat any leftover pending as skipped.
        counts.skipped_no_channel += 1;
        break;
      default:                    counts.failed += 1;
    }
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

  // Pull failure reasons from the runner result so the hint can name
  // the actual error instead of "open prospect detail". Failures aren't
  // logged to audit_events (only blocks are), so the runner.results
  // array is the only place this lives. Take the first reason as
  // representative — they tend to cluster (OpenRouter outage, missing
  // contact_name, etc).
  let firstFailureReason: string | null = null;
  if (runnerResult && typeof runnerResult === 'object' && Array.isArray((runnerResult as { results?: unknown }).results)) {
    const failures = ((runnerResult as { results: Array<{ outcome: string; reason?: string }> }).results)
      .filter((r) => r.outcome === 'failed' && r.reason);
    if (failures.length > 0) firstFailureReason = failures[0].reason || null;
  }

  // Compose the hint. Multiple categories can be non-zero; surface every
  // one that has a non-trivial remediation, in decreasing operator-action
  // priority (queued = success, blocked = re-enrich, failed = inspect,
  // no_channel = connect, sent/replied = informational).
  const parts: string[] = [];
  if (counts.queued > 0) parts.push(`${counts.queued} ready for review in Approvals.`);
  if (counts.blocked > 0) {
    if (noEvidenceCount > 0 && complianceFlagCount === 0) {
      parts.push(`${counts.blocked} blocked: partner has no Brave/LinkedIn evidence yet — click "Re-enrich evidence" to fix.`);
    } else if (noEvidenceCount === 0 && complianceFlagCount > 0) {
      parts.push(`${counts.blocked} blocked by compliance regex — open prospect detail to see the flagged terms.`);
    } else {
      parts.push(`${counts.blocked} blocked (${noEvidenceCount} no-evidence, ${complianceFlagCount} compliance) — re-enrich the no-evidence ones first.`);
    }
  }
  if (counts.failed > 0) {
    const reasonClip = firstFailureReason
      ? `: "${firstFailureReason.slice(0, 200)}${firstFailureReason.length > 200 ? '…' : ''}"`
      : '';
    parts.push(`${counts.failed} failed${reasonClip}. Open prospect detail for the per-step error trail.`);
  }
  if (counts.skipped_no_channel > 0) parts.push(`${counts.skipped_no_channel} skipped — Step 1 needs an active LinkedIn channel. Connect one in /channels.`);
  if (counts.sent_or_replied > 0) parts.push(`${counts.sent_or_replied} already sent or replied (historical).`);
  if (counts.no_pending_step > 0) parts.push(`${counts.no_pending_step} have no sequence assigned — click "2. Assign Sequence" first.`);

  const hint = runnerError
    ? `Renderer threw before finishing: ${runnerError}`
    : parts.length > 0
      ? parts.join(' ')
      : 'No state change. The cron may already be processing these — try Approvals in 30s.';

  // Per-partner outcome cards: every selected partner gets one card
  // explaining what we tried, what we had to work with, and what the
  // operator can do next. This is the "human researcher" UX direction —
  // never let a failure surface as an opaque status code.
  const failureReasonsByPartner = new Map<string, string>();
  if (runnerResult && typeof runnerResult === 'object' && Array.isArray((runnerResult as { results?: unknown }).results)) {
    for (const r of (runnerResult as { results: Array<{ partner_id: string; outcome: string; reason?: string }> }).results) {
      if (r.reason && (r.outcome === 'failed' || r.outcome === 'compliance_blocked')) {
        failureReasonsByPartner.set(r.partner_id, r.reason);
      }
    }
  }

  const outcomes = allowedIds.map((pid) => buildOutcome({
    partner: partnerById.get(pid)!,
    firstStep: postFirstByPartner.get(pid),
    blockReason: blockReasonsByPartner.get(pid),
    failureReason: failureReasonsByPartner.get(pid),
  }));

  return NextResponse.json({
    ok: true,
    counts,
    hint,
    outcomes,
    partner_states: stateMap(allowedIds, postFirstByPartner),
    runner_result: runnerResult,
    runner_error: runnerError,
  });
}

/**
 * Build one operator-facing outcome card for a single partner. Answers
 * three questions: what did we try, what did we have to work with, what
 * are the operator's options.
 */
function buildOutcome(args: {
  partner: {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_linkedin: string | null;
    evidence_enriched_at: string | null;
    profile_recent_posts: Array<unknown> | null;
    firm_recent_news: Array<unknown> | null;
    firm_named_deals: Array<unknown> | null;
    last_session_notes: string | null;
    network_distance: string | null;
  };
  firstStep: { status: string; outbound_message_id: string | null } | undefined;
  blockReason: string | undefined;
  failureReason: string | undefined;
}): PartnerOutcome {
  const { partner, firstStep, blockReason, failureReason } = args;

  const recipient = partner.contact_name
    ? `${partner.contact_name} at ${partner.company_name}`
    : partner.company_name;

  // What we have to work with — same checklist the renderer's extractor uses.
  const evidenceBoxes = [
    { label: `Firm: ${partner.company_name}`, have: true },
    { label: `Contact name: ${partner.contact_name ?? '(missing)'}`, have: !!partner.contact_name },
    { label: 'LinkedIn URL for the contact', have: !!partner.contact_linkedin },
    { label: 'Recent LinkedIn posts (≥3)', have: Array.isArray(partner.profile_recent_posts) && partner.profile_recent_posts.length >= 3 },
    { label: 'Brave firm news', have: Array.isArray(partner.firm_recent_news) && partner.firm_recent_news.length > 0 },
    { label: 'Named portfolio deals', have: Array.isArray(partner.firm_named_deals) && partner.firm_named_deals.length > 0 },
    { label: 'Operator notes on this prospect', have: !!partner.last_session_notes?.trim() },
  ];

  const status: PartnerOutcome['outcome_status'] = !firstStep
    ? 'no_sequence'
    : firstStep.status === 'queued_for_approval'
      ? 'queued'
      : firstStep.status === 'compliance_blocked'
        ? (/no discovery evidence|no_credit_signal/i.test(blockReason || '') ? 'blocked_no_evidence' : 'blocked_compliance')
        : firstStep.status === 'failed'
          ? 'failed'
          : firstStep.status === 'sent' || firstStep.status === 'replied'
            ? 'sent_or_replied'
            : firstStep.status === 'pending'
              ? 'skipped_no_channel'
              : 'failed';

  const tried = `Render the first sequence step for ${recipient}.`;

  // What actually happened, in plain English. Each branch picks
  // language matched to the remediation, not the internal status name.
  const happened = (() => {
    switch (status) {
      case 'queued':
        return 'The draft was rendered successfully and is waiting in Approvals.';
      case 'blocked_no_evidence':
        return `We couldn't find enough public information about ${recipient} to ground a personalised message in real evidence. The system refuses to send generic outreach rather than send something we can't back up.`;
      case 'blocked_compliance':
        return `The drafted message tripped a compliance rule (likely a flagged term in the template). The block reason from the audit log: "${blockReason ?? 'unknown'}".`;
      case 'failed':
        return `The renderer threw an unexpected error before producing a message. Underlying reason: "${failureReason ?? 'no detail captured'}".`;
      case 'skipped_no_channel':
        return 'The first step needs an active LinkedIn channel, and none is connected. The step is parked — once a channel is connected it will render automatically.';
      case 'sent_or_replied':
        return 'This prospect already has a message sent / reply received — nothing to do here. Historical record preserved.';
      case 'no_sequence':
      default:
        return 'No sequence is assigned to this prospect yet, so there\'s nothing to render. Run step 2 (Assign Sequence) first.';
    }
  })();

  // Actions: what the operator can DO from here, in priority order.
  // Each action is a thin wrapper around an endpoint the table already
  // calls; the client picks them up and wires existing handlers.
  const actions: PartnerOutcome['actions'] = [];
  if (status === 'queued') {
    actions.push({ label: 'Open in Approvals', action: 'open_approvals', primary: true });
  } else if (status === 'blocked_no_evidence') {
    actions.push({ label: 'Re-enrich (try broader sources)', action: 'reenrich', primary: true });
    actions.push({ label: 'Add a note about this firm', action: 'add_note' });
    actions.push({ label: 'Reset and try again', action: 'reset' });
    actions.push({ label: 'Open prospect detail', action: 'open_detail' });
  } else if (status === 'blocked_compliance') {
    actions.push({ label: 'Open prospect detail to inspect flag', action: 'open_detail', primary: true });
    actions.push({ label: 'Reset and try again', action: 'reset' });
  } else if (status === 'failed') {
    actions.push({ label: 'Reset and try again', action: 'reset', primary: true });
    actions.push({ label: 'Open prospect detail', action: 'open_detail' });
    actions.push({ label: 'Re-enrich first', action: 'reenrich' });
  } else if (status === 'skipped_no_channel') {
    actions.push({ label: 'Connect a LinkedIn channel', action: 'open_channels', primary: true });
  } else if (status === 'no_sequence') {
    actions.push({ label: 'Assign a sequence to this prospect', action: 'assign', primary: true });
  } else if (status === 'sent_or_replied') {
    actions.push({ label: 'Open prospect detail', action: 'open_detail' });
  }

  return {
    partner_id: partner.id,
    partner_name: recipient,
    outcome_status: status,
    what_we_tried: tried,
    what_happened: happened,
    what_we_have: evidenceBoxes,
    actions,
  };
}

export interface PartnerOutcome {
  partner_id: string;
  partner_name: string;
  outcome_status:
    | 'queued'
    | 'blocked_no_evidence'
    | 'blocked_compliance'
    | 'failed'
    | 'skipped_no_channel'
    | 'no_sequence'
    | 'sent_or_replied';
  what_we_tried: string;
  what_happened: string;
  what_we_have: Array<{ label: string; have: boolean }>;
  actions: Array<{
    label: string;
    action:
      | 'reenrich'
      | 'reset'
      | 'add_note'
      | 'open_detail'
      | 'open_approvals'
      | 'open_channels'
      | 'assign';
    primary?: boolean;
  }>;
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
