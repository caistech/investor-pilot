-- Migration 017 — products pitch + facility data columns
--
-- Replaces the hardcoded F2K facility specs (Branscombe / Seafields) and
-- pitch language in src/app/api/pipeline/draft/route.ts with per-product
-- columns. The DRAFT_PROMPT scaffold stays generic; per-tenant data is
-- interpolated at request time.
--
-- facility_summary is JSONB so each tenant can model their own facilities
-- without further schema changes (typed shape documented in
-- src/lib/pipeline/draft-prompt.ts):
--
--   [
--     {
--       "name": "Branscombe Estate (Claremont TAS)",
--       "size_label": "$16.2M senior construction",
--       "rate_label": "8.5% p.a. indicative + 1% line + 1% establishment + 0.5% exit",
--       "term_label": "~22 months, first-mortgage",
--       "evidence_anchor": "40% anchor offtake to Homes Tasmania"
--     },
--     ...
--   ]
--
-- draft_compliance_forbidden_terms is a per-product allow/deny list so the
-- operator can declare which terms must never appear in drafts (e.g. F2K
-- forbids "tokenisation", "guaranteed", "your clients", "advisor"). Empty
-- array means no per-product blocks (compliance still runs the global
-- mode-based filter from src/lib/compliance/rules.ts).

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_pitch TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS facility_summary JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS asset_class TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS geography TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ticket_size_min_label TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ticket_size_max_label TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS draft_compliance_forbidden_terms TEXT[] DEFAULT '{}';

-- Backfill the existing F2K product(s) with values that mirror what the
-- DRAFT_PROMPT had hardcoded. Targeted at rows that don't already have
-- product_pitch set, so re-running on a customised tenant is a no-op.
UPDATE products
SET
  product_pitch = 'F2K''s senior debt placement to direct lenders and family office private debt allocators. CREDIT CONVERSATION, not a product-suitability pitch — recipient is the decision-maker.',
  facility_summary = '[
    {
      "name": "Branscombe Estate (Claremont TAS)",
      "size_label": "$16.2M senior construction",
      "rate_label": "8.5% p.a. indicative + 1% line + 1% establishment + 0.5% exit",
      "term_label": "~22 months, first-mortgage",
      "evidence_anchor": "40% anchor offtake to Homes Tasmania"
    },
    {
      "name": "Seafields Estate (Geraldton WA)",
      "size_label": "$2.5M senior land",
      "rate_label": "8.0% p.a. capitalised",
      "term_label": "first-mortgage over all 141 lots",
      "evidence_anchor": "Day-1 LVR 71% dropping to 24% within 6 months; signed tri-party Cooperation Agreement 19 Mar 2026"
    },
    {
      "name": "Combined platform",
      "size_label": "$18.7M",
      "rate_label": "blended TAS+WA",
      "term_label": "construction + subdivision product diversification",
      "evidence_anchor": "Geographic + product diversification across the two facilities"
    }
  ]'::jsonb,
  asset_class = 'AU property development debt',
  geography = 'Australia (TAS, WA)',
  ticket_size_min_label = '$1M (Seafields-led for sub-$1M)',
  ticket_size_max_label = '$5M+ (combined platform pitch for $3M+ tickets)',
  draft_compliance_forbidden_terms = ARRAY[
    'guaranteed',
    'risk-free',
    'no risk',
    'tokenisation',
    'tokenised',
    'crypto',
    'blockchain',
    'RWA',
    'on-chain',
    'retail',
    'your clients',
    'advisor',
    'advise',
    'I hope this finds you well',
    'synergy',
    'mutual benefit',
    'exciting opportunity',
    'limited time',
    'exclusive',
    'act now'
  ]
WHERE product_pitch IS NULL;
