-- Migration 015 — partners.last_seen_in_run_id
--
-- first_seen_in_run_id (migration 010) tracks the ORIGIN run — the run that
-- first surfaced each partner. Set on INSERT only; preserved across
-- re-discoveries.
--
-- Operators using the Prospects "filter by run" dropdown expect the opposite
-- semantic: "show me what this LATEST run brought in (including
-- re-discoveries of partners I already had)". Without that, re-runs of
-- discover-batch over a stable territory look empty in the filter even
-- though they happily re-surfaced (and re-scored) most of the inventory.
--
-- last_seen_in_run_id solves that: every UPDATE in upsertPartner sets it,
-- so the filter can match on first_seen OR last_seen.
--
-- Backfill: copy first_seen_in_run_id into last_seen_in_run_id so existing
-- rows surface under at least one filter pick. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'partners'
      AND column_name = 'last_seen_in_run_id'
  ) THEN
    ALTER TABLE public.partners
      ADD COLUMN last_seen_in_run_id UUID REFERENCES public.discovery_runs(id) ON DELETE SET NULL;

    COMMENT ON COLUMN public.partners.last_seen_in_run_id IS
      'The most recent discovery_runs row that surfaced this partner. Updated on every UPDATE in upsertPartner. Pairs with first_seen_in_run_id (origin) to power the Prospects "filter by run" UI — partner surfaces if either matches.';
  END IF;
END $$;

UPDATE public.partners
SET last_seen_in_run_id = first_seen_in_run_id
WHERE last_seen_in_run_id IS NULL
  AND first_seen_in_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_last_seen_in_run
  ON public.partners(organisation_id, last_seen_in_run_id)
  WHERE last_seen_in_run_id IS NOT NULL;
