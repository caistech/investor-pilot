-- Migration 033 — add 'approved_queued_for_send' state to sequence_steps.
--
-- Today the approval click is INLINE: operator clicks 'Approve & send',
-- the handler dispatches via Unipile/Resend right then and there. If
-- daily_send_count has hit daily_send_cap the dispatch 429s and the
-- operator has to come back tomorrow and re-click.
--
-- Operator flagged 2026-05-19: 'I'm happy to cap sends to daily limits
-- but I should be able to pre-approve emails for automated sending
-- once the next day arrives — without re-clicking.'
--
-- This migration adds a new status the approval route sets instead of
-- dispatching inline. A cron (/api/cron/drain-send-queue) wakes every
-- 15 min, picks up to daily_remaining per client_channel, dispatches,
-- and advances the warmup counter. The existing channel-guard's
-- cap_reset_at handles the day-boundary roll-over automatically.

-- Drop the existing CHECK constraint and recreate with the new state.
-- (Postgres has no ALTER ... CONSTRAINT, so DROP + ADD is the standard
-- shape. Wrapped in a DO block for idempotency on re-apply.)
DO $$
BEGIN
  ALTER TABLE public.sequence_steps
    DROP CONSTRAINT IF EXISTS sequence_steps_status_check;

  ALTER TABLE public.sequence_steps
    ADD CONSTRAINT sequence_steps_status_check
    CHECK (status IN (
      'pending',
      'awaiting_verification',
      'queued_for_approval',
      'approved_queued_for_send',
      'sent',
      'skipped',
      'failed',
      'replied',
      'opted_out',
      'compliance_blocked'
    ));
END $$;

-- Index for the drain cron — partial index keeps it tiny since the
-- vast majority of steps are in other states. Matches existing pattern
-- (idx_sequence_steps_approval is a partial index on queued_for_approval).
CREATE INDEX IF NOT EXISTS idx_sequence_steps_drain
  ON public.sequence_steps(channel, scheduled_for)
  WHERE status = 'approved_queued_for_send';
