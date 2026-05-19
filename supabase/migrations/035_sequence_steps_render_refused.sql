-- Migration 035 — add 'render_refused' status to sequence_steps.
--
-- Today the runner marks EVERY render-time refusal as
-- 'compliance_blocked', regardless of whether the regex actually fired:
-- missing intake URL refusals, junk company-name refusals, no_credit_signal
-- refusals, OpenRouter HTTP 402 refusals — all get the same status.
-- That produces misleading operator-facing reports ("41 blocked by
-- compliance" when actually 95 were OpenRouter out-of-credits and 21
-- were junk-name refusals). Operator flagged 2026-05-19.
--
-- This status lets the runner mark renderer.ok === false rejections as
-- 'render_refused' separately from compliance.blocked === true (after
-- successful render, regex fires) which keeps the 'compliance_blocked'
-- label.
--
-- Idempotent.

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
      'compliance_blocked',
      'render_refused'
    ));
END $$;
