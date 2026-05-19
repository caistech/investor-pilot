/**
 * POST /api/sequences/reset
 *
 * Operator-triggered cleanup: deletes non-terminal sequence_steps (and
 * their outbound_messages, where present) for the specified partner_ids,
 * scoped to the operator's organisation. Used when partners were
 * assigned to the wrong template (e.g. project prospects routed to a
 * product-side sales sequence pre-migration 023) and need to be
 * re-assigned cleanly.
 *
 * Doesn't touch terminal-status rows (sent / replied / opted_out etc) —
 * those are historical record and should never be removed.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Returns:
 *   { ok: true, partners_reset: number, steps_deleted: number, messages_deleted: number }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

// Statuses that "Restart plan" wipes. The function-name promise is
// "scrub the partner's plan back to nothing so a fresh assignment
// works" — anything that isn't actively-sending or terminally-done
// belongs in here. Operator flagged 2026-05-19: Restart was leaving
// 'skipped' (from bulk-clears) and 'render_refused' (new in migration
// 035) attached to partners, so the follow-up Plan Outreach treated
// them as "already on a sequence" and refused to re-plan.
//
// Preserved (NOT wiped): 'sent', 'replied', 'opted_out' (terminal —
// historical record), 'approved_queued_for_send' (about to dispatch).
const NON_TERMINAL = [
  'pending',
  'queued_for_approval',
  'awaiting_verification',
  'compliance_blocked',
  'failed',
  'skipped',
  'render_refused',
];

const MAX_PARTNERS = 50;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  const partnerIds: string[] = Array.isArray(body?.partner_ids) ? body.partner_ids : [];
  if (partnerIds.length === 0) {
    return NextResponse.json({ error: 'partner_ids (non-empty array) required' }, { status: 400 });
  }
  if (partnerIds.length > MAX_PARTNERS) {
    return NextResponse.json({ error: `Batch size ${partnerIds.length} exceeds limit ${MAX_PARTNERS}` }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const orgId = profile.organisation_id;

  // Org-scope the partner list defensively.
  const { data: orgPartners } = await db
    .from('partners')
    .select('id')
    .in('id', partnerIds)
    .eq('organisation_id', orgId);
  const allowedIds = (orgPartners || []).map((p) => p.id as string);
  if (allowedIds.length === 0) {
    return NextResponse.json({ error: 'None of the supplied partners belong to your organisation' }, { status: 403 });
  }

  // Pull the steps we're about to delete so we can clean up linked
  // outbound_messages and report counts.
  const { data: stepsToDelete } = await db
    .from('sequence_steps')
    .select('id, outbound_message_id')
    .in('partner_id', allowedIds)
    .eq('organisation_id', orgId)
    .in('status', NON_TERMINAL);

  const stepIds = (stepsToDelete || []).map((s) => s.id as string);
  const messageIds = (stepsToDelete || [])
    .map((s) => s.outbound_message_id as string | null)
    .filter((id): id is string => !!id);

  let messagesDeleted = 0;
  if (messageIds.length > 0) {
    const { error: msgErr } = await db
      .from('outbound_messages')
      .delete()
      .in('id', messageIds)
      .eq('organisation_id', orgId);
    if (msgErr) {
      return NextResponse.json(
        { error: `Failed to delete outbound_messages: ${msgErr.message}` },
        { status: 500 },
      );
    }
    messagesDeleted = messageIds.length;
  }

  let stepsDeleted = 0;
  if (stepIds.length > 0) {
    const { error: stepErr } = await db
      .from('sequence_steps')
      .delete()
      .in('id', stepIds)
      .eq('organisation_id', orgId);
    if (stepErr) {
      return NextResponse.json(
        { error: `Failed to delete sequence_steps: ${stepErr.message}` },
        { status: 500 },
      );
    }
    stepsDeleted = stepIds.length;
  }

  // Reset stale partner.status badges. Without this, partners whose
  // steps we just wiped keep wearing their old 'draft_ready' / 'drafted'
  // badges on the Prospects list — visually identical to having an
  // actual draft, even though the step row is gone. Operator flagged
  // 2026-05-19 after the out_of_scope purge: the table still LOOKED
  // unchanged because partner.status hadn't been reset. The reset
  // endpoint's promise is "scrub the partner back to plannable state",
  // so wiping the badge is part of the same promise. Sent / replied /
  // follow_up_due / meeting_booked / closed_* are NOT touched — those
  // reflect real historical events.
  const STALE_BADGES = ['draft_ready', 'drafted', 'queued_for_approval', 'queued', 'awaiting_verification'];
  const { data: stalePartners } = await db
    .from('partners')
    .select('id')
    .in('id', allowedIds)
    .eq('organisation_id', orgId)
    .in('status', STALE_BADGES);
  let partnerStatusesReset = 0;
  if (stalePartners && stalePartners.length > 0) {
    const { error: stErr } = await db
      .from('partners')
      .update({ status: 'contact_found' })
      .in('id', stalePartners.map(p => p.id as string))
      .eq('organisation_id', orgId);
    if (stErr) {
      return NextResponse.json(
        { error: `Failed to reset partner.status: ${stErr.message}` },
        { status: 500 },
      );
    }
    partnerStatusesReset = stalePartners.length;
  }

  return NextResponse.json({
    ok: true,
    partners_reset: allowedIds.length,
    steps_deleted: stepsDeleted,
    messages_deleted: messagesDeleted,
    partner_statuses_reset: partnerStatusesReset,
  });
}
