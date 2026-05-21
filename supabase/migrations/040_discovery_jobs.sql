-- Migration 040 — discovery_jobs
--
-- Background-job pattern for /api/pipeline/discover-batch. The original
-- route ran the entire discovery synchronously, which fit under Vercel's
-- 60s edge gateway wall only with MAX_TOTAL_CANDIDATES <= 30. Lifting
-- that ceiling requires moving the work to a cron-driven worker that
-- runs against the 300s function ceiling (see
-- src/app/api/cron/run-discovery-jobs/route.ts).
--
-- Per the wall-time-discipline memory: Vercel's edge gateway forcibly
-- closes the browser TCP connection at ~60s even when the underlying
-- serverless function is still allowed to run to 300s. The fix is
-- structural — return a job_id immediately, let the client poll.
--
-- Each row tracks one discovery batch invocation:
--   * params  — the operator-supplied request body, replayed by the worker
--   * result  — the route response shape (queries_used, top_results, etc.)
--               so the polling endpoint can return exactly what the old
--               sync route used to return
--   * error   — populated only when status='failed'
--
-- Indexes:
--   * (organisation_id, created_at DESC) — drives the polling page
--                                          ("my org's recent jobs")
--   * (status, created_at ASC)           — drives the cron worker pickup
--                                          order (oldest pending first)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + IF NOT EXISTS on indexes/policies.

CREATE TABLE IF NOT EXISTS public.discovery_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  product_id           UUID REFERENCES public.products(id) ON DELETE SET NULL,
  project_id           UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- params: the JSON body the operator's POST sent (query_count, sources,
  -- network_tiers, enrich_with_brave, product_id/project_id). The worker
  -- replays this verbatim so the route handler stays a thin wrapper.
  params               JSONB NOT NULL,
  -- result: the full response shape the old sync route used to return
  -- (queries_used, candidates_found, candidates_unique, candidates_scored,
  -- candidates_failed, search_errors, scoring_errors, top_results,
  -- tier_breakdown, sources_used, network_tiers_used, run_id, run_code).
  -- NULL until the worker completes.
  result               JSONB,
  error                TEXT,
  created_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
);

-- Polling-page index: org + recent. The product detail card polls
-- `/api/pipeline/discover-jobs/[id]` by primary key (covered by PK), but
-- a future "recent discovery jobs" view will list by org.
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_org_created
  ON public.discovery_jobs(organisation_id, created_at DESC);

-- Worker-pickup index. The cron worker selects the oldest pending job:
--   WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1.
-- Partial-index hint not used because status moves through 4 states and
-- we want fast lookups for 'running' too (recovery / monitoring queries).
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status_created
  ON public.discovery_jobs(status, created_at ASC);

ALTER TABLE public.discovery_jobs ENABLE ROW LEVEL SECURITY;

-- Read policy: operators see jobs for their active org. Mirrors the
-- partners / discovery_runs pattern post-029 via current_active_org_id().
-- The function COALESCEs JWT claim → profile lookup so it works during
-- the multi-org transition window too.
DROP POLICY IF EXISTS "Org members can view discovery_jobs" ON public.discovery_jobs;
CREATE POLICY "Org members can view discovery_jobs" ON public.discovery_jobs
  FOR SELECT
  USING (organisation_id = public.current_active_org_id());

-- No INSERT / UPDATE / DELETE policies — only the service-role client
-- (inside /api/pipeline/discover-batch and /api/cron/run-discovery-jobs)
-- writes rows. Both routes scope explicitly by organisation_id; client-
-- side mutations would bypass the cron-coordination contract.
