-- Migration 022 — projects fundraising columns
--
-- Promotes `projects` from "linked F2K project for the lender discovery
-- query generator" to a first-class peer of `products`. After this:
--
--   * Products = sales discovery (find customers, channel partners, resellers)
--   * Projects = fundraising discovery (find investors, lenders, LPs)
--
-- Both entities now carry their own scoring rubric + ICP categories so the
-- discovery scorer can rank candidates against the right ICP regardless of
-- which side the operator is working. The generators (one-shot Claude
-- calls) accept either entity and switch their system prompt accordingly
-- (customer ICP designer vs investor ICP designer).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS everywhere; no backfill UPDATE
-- since F2K's existing project already lives in this org and the
-- operator regenerates the rubric via the UI.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS investment_thesis TEXT;

-- Same scoring config the products table carries (migration 018 added
-- these to products). The rubric scaffold is shared (5 dimensions) but
-- the prompt that generates it is investor-focused per project.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scoring_rubric TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icp_categories TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icp_partner_type TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icp_reject_categories TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icp_special_cases TEXT[];

-- Investor-side facility / raise summary fields. Useful for the
-- generator + drafts so the prompt has concrete terms to quote
-- ("$2-5M tickets, 8.5% indicative, 22mo term"). target_round can
-- be free text so non-VC raises (debt, partnership, etc) aren't
-- forced into a VC-stage label.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_round TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS round_size_label TEXT;

-- Column comments for self-documentation
COMMENT ON COLUMN projects.investment_thesis IS
  'Multi-sentence pitch describing why an investor should care: the asset, the team, the traction, the ask. Generators use this the way products.product_pitch is used.';
COMMENT ON COLUMN projects.scoring_rubric IS
  'Multi-line rubric Claude reads when scoring each candidate against this PROJECT''s ICP (investor side). Same 5-dimension scaffold as products.scoring_rubric.';
COMMENT ON COLUMN projects.target_round IS
  'Free-text round / facility label. Examples: "Pre-seed", "Series A", "Senior debt", "LP commitment", "Strategic partnership".';
COMMENT ON COLUMN projects.round_size_label IS
  'Free-text target raise size. Examples: "$2M-$5M", "AUD 18.7M aggregate across 2 facilities", "$500K bridge".';
