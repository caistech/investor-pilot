-- Migration 032 — allow 'buyer' on partners.partner_type
--
-- Products (sales side) target BUYERS, not lenders or generic
-- "partners". The discover-batch + scoring pipeline now sets
-- icp_partner_type='buyer' on products, but the partners table's
-- CHECK constraint (last widened in migration 008 for the lender
-- channel) silently rejects 'buyer' values, causing every product-
-- side discovery upsert to fail invisibly the same way the lender
-- channel did before 008.
--
-- This migration widens the CHECK constraint to include 'buyer'
-- while preserving all existing values so already-stored rows
-- remain valid.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS is a no-op when the
-- constraint isn't present; the subsequent ADD recreates it
-- from scratch.

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_partner_type_check;

ALTER TABLE partners
  ADD CONSTRAINT partners_partner_type_check
  CHECK (partner_type IN ('referral', 'integration', 'reseller', 'combination', 'lender', 'buyer'));
