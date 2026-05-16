-- Migration 019 — clear F2K-specific backfill from non-F2K rows
--
-- Migrations 016/017/018 backfilled F2K's hardcoded sender, pitch, ICP, and
-- facility data into ANY row with a NULL value in those columns. That was
-- intended for the single-tenant F2K case but ended up contaminating other
-- organisations and products in the same Supabase instance:
--
--   organisations:
--     - "Corporate AI Solutions" (the F2K tenant)        ← keep backfill
--     - "Global buildtech Australia"                      ← clear
--     - "GGK"                                             ← clear
--   products:
--     - "F2K Government Housing Fund 1" (the F2K product) ← keep backfill
--     - "Storefront-MCP"                                  ← clear
--
-- This migration NULLs the Phase A/B/C columns on every org/product EXCEPT
-- those identified by name as the legitimate F2K tenant. The next operator
-- to touch those rows configures via /settings (or accepts the NULLs and
-- the API surfaces a clear "configure /settings" 400).
--
-- Idempotent: re-running matches by name and is a no-op if those rows have
-- already been cleared (sets NULL to NULL).

-- Clear sender identity from non-F2K organisations
UPDATE organisations
SET sender_name = NULL,
    sender_role = NULL,
    signature_block = NULL
WHERE name <> 'Corporate AI Solutions';

-- Clear pitch + facility data from non-F2K products
UPDATE products
SET product_pitch = NULL,
    facility_summary = NULL,
    asset_class = NULL,
    geography = NULL,
    ticket_size_min_label = NULL,
    ticket_size_max_label = NULL,
    draft_compliance_forbidden_terms = '{}'
WHERE name <> 'F2K Government Housing Fund 1';

-- Clear ICP / scoring rubric from non-F2K products
UPDATE products
SET scoring_rubric = NULL,
    icp_categories = NULL,
    icp_partner_type = NULL,
    icp_reject_categories = NULL,
    icp_special_cases = NULL
WHERE name <> 'F2K Government Housing Fund 1';
