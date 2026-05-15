-- Migration 012 — clean up Hunter contamination + backfill company_name
--
-- TWO bugs from the LinkedIn-sourced discovery path, both visible on the
-- Prospects view on 2026-05-15:
--
--   1. discover-batch's linkedInPersonToCandidate set partners.domain to
--      "linkedin.com/in/<public_id>" when no real company domain was
--      available. When the operator then clicked "Enrich Selected", the
--      enrich route called Hunter's domain-search with that pseudo-domain;
--      Hunter silently stripped the path and returned the top-confidence
--      employee for linkedin.com itself — same generic email
--      (e.g. rnella@linkedin.com) attached to every contaminated partner.
--
--   2. linkedInPersonToCandidate fell back to person.full_name for the
--      partner's `name` (→ company_name) when current_company was null,
--      causing the Prospects view to show the PERSON's name in the
--      "Company" column instead of their firm.
--
-- Forward-fixes shipped alongside (commit pending):
--   - Enrich route: skip Hunter for domains containing '/'
--   - Discover route: extract firm from headline before falling back to
--     the person's name
--
-- This migration backfills the existing 73 prospects to remove the
-- contamination and best-effort-fix company_name for the affected rows.
-- Idempotent — re-running it is a no-op (the WHERE clauses are predicated
-- on the contamination signature).

-- ============================================================================
-- Step 1 — Hunter-contaminated rows
-- ============================================================================
-- Detect: LinkedIn-sourced row, pseudo-domain, contact_email points back at
-- linkedin.com itself. All three together = unambiguous contamination.
--
-- Repair:
--   • Restore contact_name from company_name (where the person's real name
--     ended up due to the discover-bug fallback).
--   • Extract real firm name from contact_title (LinkedIn headline).
--   • NULL out the contaminated email fields so the UI shows "no email".
--   • Roll status back to 'scored' if the contamination falsely advanced
--     it to 'contact_found'.
UPDATE partners
SET
  contact_name = company_name,
  contact_email = NULL,
  contact_source = NULL,
  email_status = NULL,
  email_confidence = NULL,
  company_name = COALESCE(
    NULLIF(
      TRIM(REGEXP_REPLACE(
        (regexp_match(contact_title, ' (?:at|@|-|\|) (.+)$', 'i'))[1],
        '\s*[/,].*$', ''
      )),
      ''
    ),
    'Unknown firm (' || company_name || ')'
  ),
  status = CASE WHEN status = 'contact_found' THEN 'scored' ELSE status END,
  last_updated_at = NOW()
WHERE (source IN ('linkedin', 'sales_nav') OR source IS NULL)
  AND domain LIKE 'linkedin.com/%'
  AND contact_email LIKE '%@linkedin.com';

-- ============================================================================
-- Step 2 — Person-as-company rows that escaped contamination
-- ============================================================================
-- Rows that were discovered but never enriched still have company_name set
-- to the person's name. No contamination, but the Prospects view shows the
-- person's name in the Company column — same visual confusion. Backfill
-- company_name from contact_title where extraction succeeds.
--
-- Only updates rows where the extraction yields a non-empty firm name;
-- otherwise leaves the row alone (better to keep the person's name visible
-- than to overwrite with an empty string).
UPDATE partners
SET
  company_name = TRIM(REGEXP_REPLACE(
    (regexp_match(contact_title, ' (?:at|@|-|\|) (.+)$', 'i'))[1],
    '\s*[/,].*$', ''
  )),
  last_updated_at = NOW()
WHERE source IN ('linkedin', 'sales_nav')
  AND domain LIKE 'linkedin.com/%'
  AND company_name = contact_name
  AND contact_title IS NOT NULL
  AND (regexp_match(contact_title, ' (?:at|@|-|\|) (.+)$', 'i'))[1] IS NOT NULL
  AND LENGTH(TRIM(REGEXP_REPLACE(
        (regexp_match(contact_title, ' (?:at|@|-|\|) (.+)$', 'i'))[1],
        '\s*[/,].*$', ''
      ))) BETWEEN 2 AND 120;
