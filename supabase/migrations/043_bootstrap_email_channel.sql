-- Migration 043 — Bootstrap email client_channels row for orgs with Resend
--
-- Burned 2026-05-21: dennis tried to draft messages, sequencer skipped
-- every step with "no usable channel" even though Resend is wired up in
-- Vercel env (RESEND_API_KEY + RESEND_FROM_EMAIL). The gate: sequencer
-- requires a client_channels row of channel_type='email' before it'll
-- render email-touch steps, but the LinkedIn/Unipile OAuth connect flow
-- doesn't create email rows (Resend is env-driven, no OAuth).
--
-- Per the [[email-channel-bootstrap]] memory this is the documented
-- provisioning step until the auto-create-on-org-create code lands.
--
-- This migration:
--   1. Backfills an active email client_channels row for every org whose
--      owner exists, doesn't already have an email channel, and is
--      assumed to want email-sending (every active org in the portfolio).
--   2. Uses the env's RESEND_FROM_EMAIL as account_identifier when the
--      migration runs locally; otherwise leaves the placeholder
--      'noreply@updates.corporateaisolutions.com' (the canonical CAS
--      sender per the Email Infrastructure rule) — the runtime sender
--      reads from RESEND_FROM_EMAIL anyway, the column is mostly
--      cosmetic for identification.
--   3. Sets warmup_day = 30 to bypass the 21-day LinkedIn-style ramp
--      — email doesn't need a connection-request warmup curve.
--
-- Idempotent: ON CONFLICT on the unique (organisation_id, channel_type,
-- account_identifier) constraint does nothing if a row already exists.

DO $$
DECLARE
  inserted INT;
BEGIN
  WITH d AS (
    INSERT INTO public.client_channels (
      organisation_id,
      user_id,
      channel_type,
      provider,
      account_identifier,
      status,
      daily_send_cap,
      daily_send_count,
      warmup_day
    )
    SELECT
      o.id,
      o.owner_id,
      'email',
      'resend',
      'noreply@updates.corporateaisolutions.com',
      'active',
      50,
      0,
      30
    FROM public.organisations o
    WHERE o.owner_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.client_channels c
        WHERE c.organisation_id = o.id
          AND c.channel_type = 'email'
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted FROM d;

  RAISE NOTICE '[043] Bootstrapped email client_channels row for % org(s)', inserted;
END $$;
