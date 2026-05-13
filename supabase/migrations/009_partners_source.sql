-- Migration 009 — partners.source for filtering and badge display
--
-- The discovery pipeline already tracks 'source' on every candidate
-- (linkedin / sales_nav / brave) but never persists it on the partners
-- table. Adding it now so the Prospects view can:
--   1. Display where each row came from (LinkedIn vs Brave),
--   2. Combine with network_distance to filter by tier (1st, 2nd, cold, brave),
--   3. Drive sequence routing decisions deterministically.
--
-- Backfill: presence of contact_linkedin is the signal that a row came
-- from LinkedIn / Sales Navigator search. Brave rows never have a
-- contact_linkedin value (the Brave path stores company-only data).
-- This is a heuristic — fine for legacy data, accurate going forward.
--
-- Side housekeeping: migration 001 created a trigger
-- update_partners_updated_at that calls update_updated_at() which sets
-- NEW.updated_at — but partners uses 'last_updated_at', not 'updated_at'.
-- The trigger has been silently failing on every UPDATE since day one
-- (PostgREST swallows the error in some code paths). Replacing it with
-- a partners-specific trigger that targets the correct column. Without
-- this fix, the backfill UPDATE below errors out and rolls back.
--
-- Idempotent.

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Replace the broken trigger with one that updates the actual column name.
DROP TRIGGER IF EXISTS update_partners_updated_at ON partners;

CREATE OR REPLACE FUNCTION update_partners_last_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_partners_last_updated_at_trigger ON partners;
CREATE TRIGGER update_partners_last_updated_at_trigger
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_partners_last_updated_at();

-- Now the backfill UPDATE can run successfully.
UPDATE partners
SET source = CASE
  WHEN contact_linkedin IS NOT NULL AND contact_linkedin != '' THEN 'linkedin'
  ELSE 'brave'
END
WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_partners_source ON partners(source);
