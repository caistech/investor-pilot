-- Migration 026 — compliance_mode per project / product
--
-- The compliance ruleset (forbidden terms, soft-flags) was being applied
-- per sequence_template — but new project + product sequence generators
-- hardcoded `'standard'` so every freshly-generated sequence got the
-- minimal ruleset regardless of domain. Meanwhile the legacy F2K seed
-- template used 'finance_au_senior_debt' and the Settings UI showed
-- that as the "active" mode, misleading every other operator into
-- thinking it applied to their work.
--
-- Move the source of truth one level up: each project + product carries
-- its own compliance_mode. When the operator generates a sequence for
-- that project / product, the generator copies the mode through to the
-- sequence_template. Operator can pick the appropriate ruleset per
-- project (LingoPure EdTech = 'standard'; F2K senior debt =
-- 'finance_au_senior_debt') from the project / product edit form.
--
-- Idempotent. Default 'standard' so brand-new rows are conservative
-- (light-touch ruleset, only blocks "guarantee" / "risk-free"). Operator
-- explicitly upgrades to a stricter mode when the domain warrants.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS compliance_mode TEXT DEFAULT 'standard';
ALTER TABLE products ADD COLUMN IF NOT EXISTS compliance_mode TEXT DEFAULT 'standard';

-- Soft constraint via CHECK rather than FK — the ruleset registry is
-- code-side (src/lib/compliance/rules.ts) for now. When that moves to a
-- DB-backed table (Phase B), this CHECK becomes a FK.
DO $$ BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_compliance_mode_check
    CHECK (compliance_mode IN ('standard', 'finance_au_senior_debt', 'finance_au_wholesale', 'finance_us'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_compliance_mode_check
    CHECK (compliance_mode IN ('standard', 'finance_au_senior_debt', 'finance_au_wholesale', 'finance_us'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN projects.compliance_mode IS
  'Pre-send compliance ruleset (src/lib/compliance/rules.ts). Default standard = light-touch (block guarantee/risk-free). Set to finance_au_senior_debt for AU credit / wholesale debt outreach. Inherited by every sequence template the operator generates for this project.';

COMMENT ON COLUMN products.compliance_mode IS
  'Pre-send compliance ruleset (src/lib/compliance/rules.ts). Default standard. Inherited by every sequence template the operator generates for this product.';
