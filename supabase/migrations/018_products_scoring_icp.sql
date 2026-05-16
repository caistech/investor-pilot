-- Migration 018 — products scoring ICP columns
--
-- Replaces the F2K-specific SCORING_PROMPT that was duplicated across
-- src/app/api/pipeline/discover/route.ts and src/lib/discovery/scorer.ts
-- with per-product columns. The scoring prompt scaffold (5 dimensions,
-- JSON return shape, low-confidence rule) stays in code; per-tenant ICP
-- specifics interpolate from these columns.
--
-- Field semantics:
--   scoring_rubric — multi-line text describing how each of the 5 dimensions
--     is scored for THIS product (capital fit, asset class, track record,
--     decision authority, geography). The prompt scaffold quotes this verbatim.
--   icp_categories — valid category labels Claude should pick from (e.g.
--     "single family office | private credit fund | HNW direct lender")
--   icp_partner_type — the single value to set on partners.partner_type
--     (e.g. "lender", "advisor", "reseller")
--   icp_reject_categories — categories that auto-cap scores at 0-2 across
--     all dimensions (the prompt's REJECT block)
--   icp_special_cases — exception list shown as DO NOT REJECT (used to
--     override a previous narrower ICP without removing the reject list)

ALTER TABLE products ADD COLUMN IF NOT EXISTS scoring_rubric TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS icp_categories TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS icp_partner_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS icp_reject_categories TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS icp_special_cases TEXT[];

-- Backfill the existing F2K product(s) with the rubric + ICP that was
-- previously hardcoded. Targeted at rows that don't already have
-- scoring_rubric set, so re-running on a customised tenant is a no-op.
UPDATE products
SET
  scoring_rubric = E'- audience_overlap_score (weight 25% — CAPITAL + TICKET FIT): Does this lender write $1M-$5M cheques into private debt? 10/10 = documented $2-5M tickets regularly; capacity for $5M+. 5-7 = writes private debt but ticket size unclear or smaller. 1-4 = equity-only or institutional-scale only.\n\n- complementarity_score (weight 25% — ASSET CLASS FOCUS): Construction finance / property development debt, with bonus weight for modular/prefab and cross-border deal history. 10/10 = construction-finance specialist with documented offshore or cross-border deals (Singapore/HK/US/UK/UAE funds with EM construction exposure). 7-9 = construction-finance specialist without explicit cross-border evidence. 5-7 = private debt focus but unclear if construction/property. 1-4 = wrong asset class (tech VC, equities, etc).\n\n- strategic_leverage_score (weight 25% — TRACK RECORD): Documented construction-finance or real-estate-debt position in past 36 months, ESPECIALLY cross-border or offshore-funded. This is the STRONGEST predictor. 10/10 = public evidence (LinkedIn post, fund report, press) of recent offshore or cross-border construction finance, or modular/prefab construction lending. 7-9 = recent AU/domestic construction-debt position. 5-7 = some real-estate exposure but not specifically construction. 1-4 = no evidence of relevant lending history.\n\n- partner_readiness_score (weight 15% — DECISION AUTHORITY + CADENCE): Personal allocation authority; decides in weeks not months. 10/10 = FO principal / CIO / personal capital / fund partner with offshore mandate flexibility. 5-7 = senior role at small private debt vehicle. 1-4 = analyst-level or slow committee gating.\n\n- reachability_score (weight 10% — GEOGRAPHIC + LINKEDIN VISIBILITY): Singapore / Hong Kong / NYC / London / Dubai construction-finance specialists are HIGHEST (these are F2K''s primary market). Miami / SF / other US financial hubs HIGH. Sydney / Melbourne MEDIUM-HIGH (AU secondary). Brisbane / Perth / other AU MEDIUM. Other regions LOW. 10/10 = primary-market construction-finance specialist with high LinkedIn visibility. 7-9 = right region or right specialism, both not both. 5-7 = AU domestic-only with thin offshore mandate. 1-4 = wrong geography AND wrong specialism.',
  icp_categories = ARRAY[
    'single family office',
    'multi family office',
    'private credit fund',
    'HNW direct lender',
    'SMSF private debt'
  ],
  icp_partner_type = 'lender',
  icp_reject_categories = ARRAY[
    'Retail bank credit officers',
    'Mortgage brokers',
    'Equity-only family offices (no debt allocation)',
    'Tech / venture-focused family offices',
    'Public REIT managers',
    'Pure listed-equity advisors',
    'Generic financial advisors placing retail client money',
    'Pure AU-domestic property credit funds with no offshore mandate flexibility AND no construction-finance track record',
    'Bank-owned platforms (slow approval timelines)',
    'Retail mortgage trusts and listed mortgage funds'
  ],
  icp_special_cases = ARRAY[
    'Institutional debt funds >$1B AUM IF they have a Singapore/HK/US/UK construction-specialist desk — they routinely write $5-25M tranches in cross-border deals at exactly the right ticket size',
    'Large family offices in Singapore/HK/Dubai that publicly engage on offshore construction or real-asset deals'
  ]
WHERE scoring_rubric IS NULL;
