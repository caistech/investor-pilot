-- Migration 042 — Backfill client_channels.user_id for legacy NULL rows
--
-- Burned 2026-05-21: dennis connected his LinkedIn today (post-038 wipe),
-- the auth-link was created with the correct user_id in the name field,
-- but the resulting client_channels row landed with user_id = NULL.
-- (Either Unipile didn't return the name field on the webhook, the legacy
-- single-user-org fallback branch fired, or there's a race in the parser.)
--
-- Effect: sequencer's per-member channel matching at runner.ts:208-211
-- couldn't pair the step (created_by_user_id = dennis) with the channel
-- (user_id = NULL) → every step skipped_no_channel → "Step 1 needs an
-- active LinkedIn channel" false alarm even though the channel was active.
--
-- This migration repairs the data. The sequencer code is also being
-- updated in the same PR with a more forgiving fallback (matches a
-- user_id-NULL channel when no owner-specific match exists).
--
-- Strategy:
--   For each org with at least one client_channels row where user_id IS
--   NULL: find the org's owner_id (organisations.owner_id), assign that
--   to the NULL rows. Single-user orgs all have one owner so this is
--   safe. Multi-member orgs get the owner as the channel owner, which
--   is the right default — a multi-member workspace that needs more
--   granular attribution can re-connect under each member's account.
--
-- Idempotent: only touches rows where user_id IS NULL. Re-running is
-- a no-op once the backfill has landed.

DO $$
DECLARE
  affected INT;
BEGIN
  WITH d AS (
    UPDATE public.client_channels c
       SET user_id = o.owner_id
      FROM public.organisations o
     WHERE c.organisation_id = o.id
       AND c.user_id IS NULL
       AND o.owner_id IS NOT NULL
     RETURNING 1
  )
  SELECT COUNT(*) INTO affected FROM d;

  RAISE NOTICE '[042] Backfilled user_id on % client_channels rows (was NULL, now organisations.owner_id)', affected;
END $$;
