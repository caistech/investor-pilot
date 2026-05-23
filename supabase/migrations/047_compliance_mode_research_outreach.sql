-- Migration 047 — add 'research_outreach' to compliance_mode CHECK constraints
--
-- Extends the compliance_mode enum (CHECK-based, not a true enum) to support
-- research-style outreach campaigns where the message is a question, not a
-- pitch. Used by CAS's distributor-discovery methodology (see
-- Corporate-AI-Solutions/docs/DISTRIBUTOR_DISCOVERY_METHODOLOGY.md) which
-- runs InvestorPilot as its validation rail.
--
-- The 'standard' mode is too permissive (allows pitch language); the
-- finance_* modes are too restrictive (block normal research messaging like
-- "would your clients pay for X" because of finance-pitch blocklists). New
-- 'research_outreach' mode is question-style: blocks pitch language, blocks
-- financial-product claims, allows research questioning.
--
-- The mode's actual rule list lives in src/lib/compliance/rules.ts and is
-- shipped alongside this migration.
--
-- Idempotent. Safe to re-apply.

DO $$ BEGIN
  ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_compliance_mode_check;
  ALTER TABLE projects ADD CONSTRAINT projects_compliance_mode_check
    CHECK (compliance_mode IN ('standard', 'finance_au_senior_debt', 'finance_au_wholesale', 'finance_us', 'research_outreach'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE products DROP CONSTRAINT IF EXISTS products_compliance_mode_check;
  ALTER TABLE products ADD CONSTRAINT products_compliance_mode_check
    CHECK (compliance_mode IN ('standard', 'finance_au_senior_debt', 'finance_au_wholesale', 'finance_us', 'research_outreach'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
