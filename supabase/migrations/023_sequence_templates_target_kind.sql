-- Migration 023 — sequence_templates.target_kind routing column
--
-- Templates carry no signal of whether they were generated for a product
-- (sales partner outreach) or a project (investor outreach). assign-batch
-- picks the first non-warm template per org, which is fine for single-
-- offering orgs but produces nonsense when the org has both — project-
-- scoped prospects get the product-side template and Claude writes a
-- channel-partner pitch to a VC.
--
-- Add target_kind so the routing layer can pick correctly. Backfill via
-- name + vertical heuristic so existing orgs aren't broken on the next
-- assign-batch call.

ALTER TABLE sequence_templates
  ADD COLUMN IF NOT EXISTS target_kind TEXT
  CHECK (target_kind IN ('product', 'project'));

-- Backfill: templates whose name or vertical contains an investor signal
-- get target_kind='project'. Everything else (channel partner, reseller,
-- direct lender even though lender is debt-side) defaults to 'product'
-- because the existing template generator was product-only until the
-- project generator landed in migration 022.
UPDATE sequence_templates SET target_kind = 'project'
  WHERE target_kind IS NULL
    AND (
      LOWER(COALESCE(name, '')) ~ '(investor|vc/pe|vc |\bvp\b|\blp\b|funding|raise|series [a-z])'
      OR LOWER(COALESCE(vertical, '')) ~ '(vc|investor|funding|series_[a-z]|seed)'
    );

UPDATE sequence_templates SET target_kind = 'product'
  WHERE target_kind IS NULL;

-- Helps assign-batch's per-org filter (`is_active = true AND target_kind = X`).
CREATE INDEX IF NOT EXISTS idx_sequence_templates_org_kind
  ON sequence_templates(organisation_id, target_kind)
  WHERE is_active = true;

COMMENT ON COLUMN sequence_templates.target_kind IS
  'product = sales partner outreach (generated from products row). project = investor / capital partner outreach (generated from projects row). assign-batch picks the template whose target_kind matches the partner''s offering linkage (project_id vs product_id).';
