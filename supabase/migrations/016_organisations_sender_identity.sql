-- Migration 016 — organisations sender identity columns
--
-- Replaces the hardcoded SENDER_NAME / SENDER_ROLE constants in
-- src/lib/sequencer/render.ts with per-organisation columns. Required for
-- multi-tenant: every tenant signs their own outbound LinkedIn DMs and
-- emails as themselves, not as the F2K sender baked into the prior shared
-- code path.
--
-- signature_block is reserved for future per-channel signatures (full HTML
-- email signatures, multi-line LinkedIn closings) — left nullable for now;
-- callers default to interpolating sender_name + sender_role into the
-- existing template strings until templates themselves move into the DB
-- (Phase D).

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS sender_role TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS signature_block TEXT;

-- Backfill the existing single-tenant F2K row(s) with the values that were
-- previously hardcoded in render.ts so the cutover preserves behaviour.
-- Targeted only at rows that don't already have sender_name set, so
-- re-running the migration on an org that's been customised is a no-op.
UPDATE organisations
SET
  sender_name = 'Dennis McMahon',
  sender_role = 'Development Manager, Factory2Key Pty Ltd | F2K Capital'
WHERE sender_name IS NULL;
