-- Migration 013 — strip the "Unknown firm (X)" placeholder from company_name
--
-- Migration 012 wrapped the person's name in "Unknown firm (X)" when no firm
-- could be extracted from the headline. That string is awkward in the UI and
-- forces the renderer to detect-and-strip on every render. Simpler: revert
-- to bare X. The UI now handles source-aware rendering — for LinkedIn-sourced
-- rows where company_name equals contact_name, show the person as the
-- primary identifier and omit the firm subtitle entirely.
--
-- Idempotent: the regex only matches rows that still have the placeholder
-- wrapper.

UPDATE partners
SET company_name = TRIM(BOTH FROM SUBSTRING(company_name FROM '^Unknown firm \((.+)\)$')),
    last_updated_at = NOW()
WHERE company_name ~ '^Unknown firm \(.+\)$';
