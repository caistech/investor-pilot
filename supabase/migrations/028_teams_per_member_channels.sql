-- Migration 028: per-member channels for the teams iteration (2026-05-18).
--
-- Each team member gets their own LinkedIn + email account; the sequencer
-- picks the right channel by step ownership rather than "any active channel
-- for the org". Additive + nullable + idempotent so single-user orgs keep
-- working without behaviour change.
--
-- Design decisions: see project memory project_teams_design_decisions.md.
--   - Per-member channels (this migration)
--   - Shared partner pool (no changes to partners)
--   - Org-wide approvals queue (no changes)
--   - Channel disconnect → step waits + flags (handled in sequencer rewire)
--   - Supabase Auth invite-by-email flow (handled in /api/team/invite)

-- ─────────────────────────────────────────────────────────────────────────
-- client_channels.user_id — owns each channel row

ALTER TABLE public.client_channels
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill: every existing channel gets assigned to the org's owner so
-- single-user orgs see no change. Picks any 'owner' row (typically one
-- per org) — if no owner exists, leaves user_id null and falls back to
-- org-wide visibility (the sequencer will treat null user_id as
-- "shared" for legacy compat).
UPDATE public.client_channels c
SET user_id = (
  SELECT id FROM public.profiles
  WHERE profiles.organisation_id = c.organisation_id
    AND profiles.role = 'owner'
  ORDER BY profiles.created_at ASC
  LIMIT 1
)
WHERE user_id IS NULL;

-- Replace the org-scoped uniqueness with per-user uniqueness so two
-- members can connect their own LinkedIn accounts under the same org.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_channels_organisation_id_channel_type_account_identif_key'
  ) THEN
    ALTER TABLE public.client_channels
      DROP CONSTRAINT client_channels_organisation_id_channel_type_account_identif_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_channels_user_channel_account_unique'
  ) THEN
    ALTER TABLE public.client_channels
      ADD CONSTRAINT client_channels_user_channel_account_unique
      UNIQUE (user_id, channel_type, account_identifier);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_channels_user ON public.client_channels(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- sequence_steps.created_by_user_id — drives channel attribution

ALTER TABLE public.sequence_steps
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: legacy steps get assigned to the org's owner so the
-- sequencer's per-user channel lookup resolves to the owner's channel
-- (which is also the only channel pre-migration).
UPDATE public.sequence_steps s
SET created_by_user_id = (
  SELECT id FROM public.profiles
  WHERE profiles.organisation_id = s.organisation_id
    AND profiles.role = 'owner'
  ORDER BY profiles.created_at ASC
  LIMIT 1
)
WHERE created_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_steps_creator ON public.sequence_steps(created_by_user_id);
