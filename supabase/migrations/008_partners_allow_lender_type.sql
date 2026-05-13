-- Migration 008 — allow 'lender' on partners.partner_type
--
-- Migration 001 set the partner_type CHECK constraint to the v1/v2 advisor-
-- partnership vocabulary: ('referral', 'integration', 'reseller', 'combination').
-- The v3 lender channel (per Senior Debt Brief v3) scores candidates as
-- partner_type = 'lender' — but the CHECK constraint silently rejected every
-- such insert, so discover-batch ran successfully end-to-end (queries
-- generated, Unipile + Brave returned 100 hits, Claude scored 40 unique
-- candidates) and then every upsert died on the constraint. Net result was
-- candidates_scored = 0 and the failure was invisible until the per-candidate
-- error message was surfaced into the API response.
--
-- This migration widens the CHECK constraint to include 'lender' while
-- preserving all legacy values so existing rows (if any) remain valid.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS is a no-op when the constraint isn't
-- present; the subsequent ADD recreates it from scratch.

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_partner_type_check;

ALTER TABLE partners
  ADD CONSTRAINT partners_partner_type_check
  CHECK (partner_type IN ('referral', 'integration', 'reseller', 'combination', 'lender'));
