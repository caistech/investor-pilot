-- Migration 014 — clean fake company_name values
--
-- After migration 013 (strip "Unknown firm (X)" wrapper) the Prospects view
-- surfaced a second class of garbage company_name values on LinkedIn-sourced
-- rows:
--
--   - "LinkedIn"     — Unipile's classic search returns this as a generic
--                      fallback when the recipient's actual employer isn't
--                      identifiable. ~7 rows in production.
--   - Headlines like "Self-Build & Sustainable Housing Advocate | Passionate
--     about Smart" / "Partnering with ConTech Firms to Enter & Grow in the
--     UK | Founder – Origin Consultants" — these are LinkedIn HEADLINES,
--     not firms, that ended up in company_name because search returned them
--     as current_company. Contain typical headline delimiters (|, " - ",
--     " at ", " @ ").
--   - Generic descriptors like "Fundraising", "Asset Finance & Leasing" —
--     domain-area labels, not firm names. Harder to detect with regex.
--
-- For the first two classes, fall back to contact_name (person primary). The
-- pipeline-table renderer detects company_name == contact_name and renders
-- the person as the primary identifier with no firm subtitle — clean visual.
--
-- For the generic-descriptor third class, we leave them alone. Distinguishing
-- "Fundraising" (bad) from "Goldman Sachs" (good) via regex would mis-fire
-- on real firms with single-word names. Future enrichment runs in full mode
-- (assign-batch) will overwrite when extractCompanyFromHeadline returns a
-- usable firm from the freshly-fetched headline.
--
-- Idempotent: WHERE clauses are predicated on the contamination signatures.

UPDATE partners
SET
  company_name = contact_name,
  last_updated_at = NOW()
WHERE source IN ('linkedin', 'sales_nav')
  AND contact_name IS NOT NULL
  AND (
    -- Generic Unipile fallback (case-insensitive exact match)
    LOWER(company_name) = 'linkedin'
    -- Headline-shaped (contains a typical headline delimiter)
    OR company_name ~ '\s+(at|@|\||-)\s+'
  );
