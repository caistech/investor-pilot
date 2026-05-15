-- Migration 010 — discovery_runs
--
-- One row per Find Investors invocation. Provides a stable anchor for tracing
-- which prospects came from which run, what queries surfaced them, and how
-- long the run took. The operator-visible run_code is a 6-char hex slice of
-- the UUID (e.g. "DR-7c1d2a") — short enough to paste in support / debug
-- conversations, no per-org sequence to manage.
--
-- partners gets a first_seen_in_run_id FK that's set on INSERT only — when
-- the same company is re-discovered in a later run, the origin run is
-- preserved so the prospect-detail view can always answer "where did this
-- candidate come from?" Re-discoveries don't lose history; we just don't
-- have a many-to-many record of every run that touched them in v1.
--
-- Per CLAUDE.md: idempotent. Wrap CREATE in IF NOT EXISTS / DO blocks.

CREATE TABLE IF NOT EXISTS public.discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_code TEXT NOT NULL,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  triggered_by UUID REFERENCES auth.users(id),
  sources TEXT[] NOT NULL DEFAULT '{}',
  network_tiers TEXT[] NOT NULL DEFAULT '{}',
  enrich_with_brave BOOLEAN NOT NULL DEFAULT FALSE,
  query_count INTEGER,
  candidates_found INTEGER,
  candidates_unique INTEGER,
  candidates_scored INTEGER,
  candidates_failed INTEGER,
  wall_time_ms INTEGER,
  queries_used JSONB,
  search_errors JSONB,
  scoring_errors JSONB,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.discovery_runs IS
  'One row per Find Investors invocation. Set on POST /api/pipeline/discover-batch entry; finalised with counts + wall time on exit. Partners discovered in a run link via partners.first_seen_in_run_id.';

COMMENT ON COLUMN public.discovery_runs.run_code IS
  'Operator-visible short code, format "DR-" + first 6 hex chars of id. Not unique-enforced; collision probability ~1 in 16M, acceptable for human-paste display.';

CREATE INDEX IF NOT EXISTS idx_discovery_runs_org_created
  ON public.discovery_runs(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_project
  ON public.discovery_runs(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discovery_runs_run_code
  ON public.discovery_runs(run_code);

-- RLS — same pattern as other tables in this project: org-scoped reads,
-- service-role writes (API routes use the service client per CLAUDE.md).
ALTER TABLE public.discovery_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discovery_runs'
      AND policyname = 'discovery_runs_select_own_org'
  ) THEN
    CREATE POLICY discovery_runs_select_own_org
      ON public.discovery_runs
      FOR SELECT
      USING (
        organisation_id IN (
          SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

-- partners.first_seen_in_run_id — set on the INSERT branch of upsertPartner,
-- never on UPDATE. Preserves the origin run when a partner is re-discovered.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'partners'
      AND column_name = 'first_seen_in_run_id'
  ) THEN
    ALTER TABLE public.partners
      ADD COLUMN first_seen_in_run_id UUID REFERENCES public.discovery_runs(id) ON DELETE SET NULL;

    COMMENT ON COLUMN public.partners.first_seen_in_run_id IS
      'The discovery_runs row that first surfaced this partner. Set on INSERT only; subsequent UPDATEs in later runs leave it alone. NULL for legacy rows discovered before migration 010.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_partners_first_seen_in_run
  ON public.partners(organisation_id, first_seen_in_run_id)
  WHERE first_seen_in_run_id IS NOT NULL;
