-- Migration 044 — Backfill products.one_pager_url + projects.one_pager_url
--
-- Renderer requires offering one_pager_url before drafting outreach
-- (blocker: 'missing_offering_url'). The products UI was missing the
-- field entirely until 2026-05-22, so every active product has NULL.
-- This migration backfills one_pager_url for every offering that:
--   - has one_pager_url currently NULL or empty
--   - AND has at least one completed url-type source in its KB
-- using the earliest completed URL source for that offering.
--
-- Idempotent: COALESCE guard means re-running is a no-op once the
-- field is non-empty.

DO $$
DECLARE
  products_filled INT;
  projects_filled INT;
BEGIN
  WITH first_url_source AS (
    SELECT DISTINCT ON (product_id)
      product_id, url
    FROM public.product_sources
    WHERE product_id IS NOT NULL
      AND source_type = 'url'
      AND processing_status = 'completed'
      AND url IS NOT NULL
      AND url <> ''
    ORDER BY product_id, created_at ASC
  ),
  d AS (
    UPDATE public.products p
       SET one_pager_url = fus.url
      FROM first_url_source fus
     WHERE p.id = fus.product_id
       AND (p.one_pager_url IS NULL OR p.one_pager_url = '')
     RETURNING 1
  )
  SELECT COUNT(*) INTO products_filled FROM d;

  WITH first_url_source AS (
    SELECT DISTINCT ON (project_id)
      project_id, url
    FROM public.product_sources
    WHERE project_id IS NOT NULL
      AND source_type = 'url'
      AND processing_status = 'completed'
      AND url IS NOT NULL
      AND url <> ''
    ORDER BY project_id, created_at ASC
  ),
  d AS (
    UPDATE public.projects p
       SET one_pager_url = fus.url
      FROM first_url_source fus
     WHERE p.id = fus.project_id
       AND (p.one_pager_url IS NULL OR p.one_pager_url = '')
     RETURNING 1
  )
  SELECT COUNT(*) INTO projects_filled FROM d;

  RAISE NOTICE '[044] Backfilled one_pager_url: % product(s), % project(s) (from first completed url-type KB source)',
    products_filled, projects_filled;
END $$;
