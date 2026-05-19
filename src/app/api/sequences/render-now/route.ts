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
  'render_refused',
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
    .select('id, partner_id, status, step_index, outbound_message_id, channel')
    .in('partner_id', allowedIds)
    .eq('organisation_id', profile.organisation_id)
    .order('step_index', { ascending: true });

  type StepRow = { id: string; partner_id: string; status: string; step_index: number; outbound_message_id: string | null; channel: string | null };
  const firstStepByPartner = new Map<string, StepRow>();
  for (const s of (existingSteps || []) as StepRow[]) {
    if (!firstStepByPartner.has(s.partner_id)) {
      firstStepByPartner.set(s.partner_id, s);
    }
  }

  // Partition partners by what needs doing.
  const noStepIds: string[] = [];      // never assigned to a sequence
  const alreadyDoneIds: string[] = []; // step exists but already rendered
  const skippedStepIds: string[] = []; // step exists but was skipped — needs re-assignment
  const needsRenderIds: string[] = []; // step is pending

  for (const pid of allowedIds) {
    const step = firstStepByPartner.get(pid);
    if (!step) {
      noStepIds.push(pid);
    } else if (step.status === 'skipped') {
      // Skipped steps are dead ends — the runner only processes 'pending'
      // status, so a skipped step will never re-render on its own. The
      // operator needs to re-run "2. Plan Outreach" to assign a fresh
      // sequence (against the current active template) before the partner
      // can be rendered again. Without this bucket, skipped steps fell
      // into needsRender, got passed to the runner, got silently ignored
      // (status != 'pending'), and the operator saw "Couldn't write any
      // messages" with no explanation. Bug surfaced 2026-05-17 after the
      // bulk-clear-approvals route shipped — 16 of 19 prospects vanished
      // from the count.
      skippedStepIds.push(pid);
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
      previously_skipped: skippedStepIds.length,
      blocked: 0,
      failed: 0,
      skipped_no_channel: 0,
    };
    const hint = skippedStepIds.length === allowedIds.length
      ? `All ${skippedStepIds.length} selected prospects have skipped drafts (likely from a recent bulk-clear). Click "2. Plan Outreach" first to re-assign fresh sequences against the current active template, THEN "3. Draft Messages Now".`
      : noStepIds.length === allowedIds.length
        ? 'None of the selected partners have a sequence assigned. Click "2. Plan Outreach" first.'
        : alreadyDoneIds.length === allowedIds.length
          ? 'All selected partners already have a rendered first message. Check Approvals — or the prospect detail page if Approvals is empty (compliance may have blocked them).'
          : (() => {
              const bits: string[] = [];
              if (skippedStepIds.length > 0) bits.push(`${skippedStepIds.length} have skipped drafts — click "2. Plan Outreach" to re-assign`);
              if (noStepIds.length > 0) bits.push(`${noStepIds.length} have no sequence — click "2. Plan Outreach"`);
              if (alreadyDoneIds.length > 0) bits.push(`${alreadyDoneIds.length} already rendered — check Approvals`);
              return `Mixed state: ${bits.join('; ')}.`;
            })();
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
    .select('id, partner_id, status, step_index, outbound_message_id, channel')
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
    // Real compliance-regex hits (renderer succeeded, regex matched a
    // forbidden term in the rendered text).
    blocked: 0,
    // Render-time refusals (renderer.ok === false) — see migration 035.
    // These are NOT compliance violations; they're upstream guards
    // refusing to produce a draft (missing intake URL, junk company
    // name, no credit signal, OpenRouter 402, etc).
    render_refused: 0,
    failed: 0,
    skipped_no_channel: 0,
    sent_or_replied: 0,
    no_pending_step: noStepIds.length,
    previously_skipped: skippedStepIds.length,
    // Kept for backwards-compatible client-side display.
    already_rendered: alreadyDoneIds.length,
  };
  // Track which channel TYPES are stuck so the operator sees the right
  // remediation ("connect an email channel" vs "connect a LinkedIn
  // channel"). Without this, the UI hardcoded "LinkedIn" even when
  // every stuck step was actually email — burned 30 min on 2026-05-19
  // chasing a non-existent LinkedIn gate.
  const stuckChannelTypes = new Set<string>();
  for (const pid of allowedIds) {
    const post = postFirstByPartner.get(pid);
    if (!post) continue; // no step at all (noStepIds covered above)
    switch (post.status) {
      case 'queued_for_approval': counts.queued += 1; break;
      case 'compliance_blocked':  counts.blocked += 1; break;
      case 'render_refused':      counts.render_refused += 1; break;
      case 'failed':              counts.failed += 1; break;
      case 'sent':
      case 'replied':             counts.sent_or_replied += 1; break;
      case 'pending':
        // Pending after a render attempt = renderer punted (no channel).
        // For partners we never tried to render this run, pending is
        // genuinely pending — but in render-now's contract every selected
        // partner gets attempted, so treat any leftover pending as skipped.
        counts.skipped_no_channel += 1;
        if (post.channel) {
          // 'linkedin_connect' / 'linkedin_dm' both need a 'linkedin'
          // channel; 'email' needs an 'email' channel.
          const ch = String(post.channel);
          if (ch.startsWith('linkedin')) stuckChannelTypes.add('LinkedIn');
          else if (ch === 'email') stuckChannelTypes.add('email');
          else stuckChannelTypes.add(ch);
        }
        break;
      default:                    counts.failed += 1;
    }
  }

  // Pull the actual refusal reasons for render_refused steps from
  // audit_events so the operator sees WHY a partner went silent. The
  // most common causes have different remediations: OpenRouter 402 →
  // operator tops up; missing_offering_url → operator fills in
  // /settings/products one_pager_url; junk company_name → operator
  // edits or deletes the partner; no_credit_signal → re-enrich evidence.
  // Without this breakdown the UI conflated everything under "blocked
  // by compliance" — sent operators hunting for forbidden terms that
  // weren't the actual cause (operator flagged 2026-05-19).
  const refusedStepIds = (postSteps || [])
    .filter((s) => s.status === 'render_refused')
    .map((s) => s.id as string);

  type BlockerKind = 'openrouter_402' | 'missing_offering_url' | 'junk_company_name' | 'no_credit_signal' | 'char_overshoot' | 'other';
  const refusalKindCount: Record<BlockerKind, number> = {
    openrouter_402: 0,
    missing_offering_url: 0,
    junk_company_name: 0,
    no_credit_signal: 0,
    char_overshoot: 0,
    other: 0,
  };
  const refusalSampleReason: Partial<Record<BlockerKind, string>> = {};

  // Per-partner refusal reason — feeds the per-partner outcome cards
  // below. Populated from the same audit lookup as the aggregate counts.
  const blockReasonsByPartner = new Map<string, string>();
  const stepToPartner = new Map((postSteps || []).map((s) => [s.id as string, s.partner_id as string]));

  if (refusedStepIds.length > 0) {
    const { data: auditRows } = await db
      .from('audit_events')
      .select('resource_id, payload, created_at')
      .eq('organisation_id', profile.organisation_id)
      .eq('action', 'sequence.render_blocked')
      .in('resource_id', refusedStepIds)
      .order('created_at', { ascending: false });
    const seenStep = new Set<string>();
    for (const row of auditRows || []) {
      const stepId = row.resource_id as string;
      if (seenStep.has(stepId)) continue; // first audit per step wins
      seenStep.add(stepId);
      const payload = (row.payload as { reason?: string; blocker?: string } | null) ?? {};
      const reason = payload.reason || payload.blocker || '';
      let kind: BlockerKind = 'other';
      if (/402|insufficient credits|openrouter/i.test(reason)) kind = 'openrouter_402';
      else if (payload.blocker === 'missing_offering_url' || /no intake URL configured/i.test(reason)) kind = 'missing_offering_url';
      else if (/looks like a scraped page title|junk company/i.test(reason)) kind = 'junk_company_name';
      else if (payload.blocker === 'no_credit_signal') kind = 'no_credit_signal';
      else if (/exceeds max \d+ chars/i.test(reason)) kind = 'char_overshoot';
      refusalKindCount[kind] += 1;
      if (!refusalSampleReason[kind]) refusalSampleReason[kind] = reason;

      const partnerId = stepToPartner.get(stepId);
      if (partnerId && !blockReasonsByPartner.has(partnerId)) {
        blockReasonsByPartner.set(partnerId, reason);
      }
    }
  }

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
    parts.push(`${counts.blocked} blocked by compliance regex — open prospect detail to see the flagged terms.`);
  }
  if (counts.render_refused > 0) {
    // Most operator-actionable refusal classes get their own line with
    // the specific remediation. The "other" bucket collects anything we
    // haven't categorised.
    if (refusalKindCount.openrouter_402 > 0) {
      parts.push(`${refusalKindCount.openrouter_402} couldn't render — OpenRouter is out of credits. Top up at https://openrouter.ai/settings/credits, then retry.`);
    }
    if (refusalKindCount.missing_offering_url > 0) {
      parts.push(`${refusalKindCount.missing_offering_url} couldn't render — the offering has no intake URL configured. Open /settings/products (or /settings/projects) and fill in the one_pager_url.`);
    }
    if (refusalKindCount.junk_company_name > 0) {
      parts.push(`${refusalKindCount.junk_company_name} couldn't render — partner company_name looks like a scraped page title. Edit or delete those partners from /prospects.`);
    }
    if (refusalKindCount.no_credit_signal > 0) {
      parts.push(`${refusalKindCount.no_credit_signal} couldn't render — no discovery evidence on partner. Click "Re-enrich evidence" on those rows.`);
    }
    if (refusalKindCount.char_overshoot > 0) {
      parts.push(`${refusalKindCount.char_overshoot} couldn't render — LLM-rendered body exceeded the template's max char limit. Bump the step's max_chars in /settings/templates or regenerate the sequence.`);
    }
    if (refusalKindCount.other > 0) {
      parts.push(`${refusalKindCount.other} couldn't render for other reasons — open prospect detail for the per-step error trail.`);
    }
  }
  if (counts.failed > 0) {
    const reasonClip = firstFailureReason
      ? `: "${firstFailureReason.slice(0, 200)}${firstFailureReason.length > 200 ? '…' : ''}"`
      : '';
    parts.push(`${counts.failed} failed${reasonClip}. Open prospect detail for the per-step error trail.`);
  }
  if (counts.skipped_no_channel > 0) {
    const channelLabel = stuckChannelTypes.size === 0
      ? 'channel'
      : stuckChannelTypes.size === 1
        ? `${Array.from(stuckChannelTypes)[0]} channel`
        : `${Array.from(stuckChannelTypes).join(' or ')} channel`;
    parts.push(`${counts.skipped_no_channel} skipped — needs an active ${channelLabel}. Connect one in /channels.`);
  }
  if (counts.sent_or_replied > 0) parts.push(`${counts.sent_or_replied} already sent or replied (historical).`);
  if (counts.no_pending_step > 0) parts.push(`${counts.no_pending_step} have no sequence assigned — click "2. Plan Outreach" first.`);
  if (skippedStepIds.length > 0) parts.push(`${skippedStepIds.length} have skipped drafts (likely from a bulk-clear) — click "2. Plan Outreach" to re-assign fresh sequences before re-rendering.`);

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
      if (r.reason && (r.outcome === 'failed' || r.outcome === 'compliance_blocked' || r.outcome === 'render_refused')) {
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
        return 'No sequence is assigned to this prospect yet, so there\'s nothing to render. Run step 2 (Plan Outreach) first.';
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
