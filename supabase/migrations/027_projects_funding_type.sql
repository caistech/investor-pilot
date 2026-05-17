-- Migration 027 — projects.funding_type
--
-- Funding type is the single most predictive ICP filter. A Series A LP
-- doesn't write construction loans; a real-estate debt fund doesn't fund
-- pre-seed equity. Without this column the operator was relying on
-- per-project ICP rubric prose to keep the scorer + discovery layer on the
-- right path, which (a) failed repeatedly in this session — VC/angel
-- noise dominated a debt-fund discovery run — and (b) couldn't be used
-- as a hard pre-filter at search time.
--
-- The 22 allowed values cover the 80% of common raise scenarios:
--
--   Equity — startup / venture:    pre_seed · seed · series_a · series_b ·
--                                  series_c_growth · convertible_safe ·
--                                  strategic_corporate_vc
--   Debt — real estate / project:  construction_debt_senior · construction_debt_mezz ·
--                                  land_acquisition_debt · bridge_refinance ·
--                                  development_equity_lp
--   Debt — business / operating:   senior_business_term_debt · working_capital_line ·
--                                  revenue_based_financing · equipment_asset_financing ·
--                                  acquisition_lbo · invoice_factoring
--   Alternative:                   grant_non_dilutive · equity_crowdfunding ·
--                                  pre_ipo_late_stage · sponsor_capital_gp_commitment
--
-- The CHECK constraint enforces the canonical set; existing ProjectType
-- (senior_debt / mezzanine / equity / platform_equity / mixed) is retained
-- separately as the coarser legacy field — it stays nullable, no backfill
-- (operators set funding_type during the next edit).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before
-- re-adding the CHECK so re-running picks up any list expansion.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS funding_type TEXT;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_funding_type_check;

ALTER TABLE projects ADD CONSTRAINT projects_funding_type_check
  CHECK (funding_type IS NULL OR funding_type IN (
    -- Equity — startup / venture
    'pre_seed',
    'seed',
    'series_a',
    'series_b',
    'series_c_growth',
    'convertible_safe',
    'strategic_corporate_vc',
    -- Debt — real estate / project finance
    'construction_debt_senior',
    'construction_debt_mezz',
    'land_acquisition_debt',
    'bridge_refinance',
    'development_equity_lp',
    -- Debt — business / operating
    'senior_business_term_debt',
    'working_capital_line',
    'revenue_based_financing',
    'equipment_asset_financing',
    'acquisition_lbo',
    'invoice_factoring',
    -- Alternative
    'grant_non_dilutive',
    'equity_crowdfunding',
    'pre_ipo_late_stage',
    'sponsor_capital_gp_commitment'
  ));

CREATE INDEX IF NOT EXISTS idx_projects_funding_type
  ON projects(organisation_id, funding_type)
  WHERE funding_type IS NOT NULL;

COMMENT ON COLUMN projects.funding_type IS
  'The specific raise scenario (e.g. series_a, construction_debt_senior, working_capital_line). Drives the discovery prompt filter so the LLM looks for the right investor type, and the ICP scoring rubric so mismatched candidates are penalised. See migration 027 for the canonical 22-value set.';
