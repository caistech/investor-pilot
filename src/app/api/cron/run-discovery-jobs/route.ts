/**
 * GET /api/cron/run-discovery-jobs
 *
 * Picks the oldest pending `discovery_jobs` row, marks it 'running',
 * executes the discovery batch against the 300s function ceiling, then
 * persists the result and marks the job 'completed' (or 'failed' on
 * exception).
 *
 * Replaces the inline-discovery code that used to live in the POST
 * /api/pipeline/discover-batch route. The route is now a thin wrapper
 * that inserts a pending row + fires-and-forgets to this endpoint, so
 * the browser never waits behind Vercel's 60s edge gateway wall.
 *
 * Auth: CRON_SECRET header (Vercel cron) OR ?key=CRON_SECRET. Mirrors
 * the pattern in /api/cron/drain-send-queue. The route is allowlisted
 * in middleware.ts via the /api/cron/* prefix.
 *
 * Per-tick behaviour:
 *   1. Pick one pending job (FIFO by created_at).
 *   2. Mark it 'running' + stamp started_at.
 *   3. Call runDiscoveryBatch with max_total_candidates=150.
 *   4. On success: write result JSON + mark 'completed' + stamp completed_at.
 *   5. On failure: write error message + mark 'failed' + stamp completed_at.
 *
 * Wall-time discipline:
 *   - One job per tick. The 2-min schedule means a backlog of 5 jobs
 *     drains in 10 minutes (no parallel cron execution). Operator-visible
 *     latency for a single discovery is ~immediate (the route fires the
 *     kick) so the cron's main job is recovering missed kicks.
 *   - maxDuration = 300s — same as the old sync route.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runDiscoveryBatch, type DiscoveryBatchParams } from '@/lib/discovery/runner';

export const maxDuration = 300;

/** The cron worker uses the 300s ceiling, so it can score up to 150. */
const WORKER_MAX_TOTAL_CANDIDATES = 150;

export async function GET(request: Request) {
  // Auth — CRON_SECRET header (Vercel cron) OR ?key=. Same pattern as the
  // other cron endpoints in this repo.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(request.url);
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('key');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const startedAt = Date.now();

  // Pick the oldest pending job. SELECT-then-UPDATE is racy in theory,
  // but the cron is single-instance per tick and the kick from the
  // discover-batch route runs after the INSERT commits — overlap risk
  // is low. If two ticks ever pick the same row, the second one's
  // UPDATE will succeed (status was already 'running') but the worker
  // will produce a duplicate result; acceptable v1 behaviour.
  const { data: job, error: pickError } = await db
    .from('discovery_jobs')
    .select('id, organisation_id, params, created_by_user_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pickError) {
    return NextResponse.json({ error: `Failed to pick job: ${pickError.message}` }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ ok: true, message: 'No pending discovery jobs', wall_time_ms: Date.now() - startedAt });
  }

  // Mark running. Stamp started_at so the polling UI can render
  // "running for Xs" without a separate timer.
  const startTs = new Date().toISOString();
  await db
    .from('discovery_jobs')
    .update({ status: 'running', started_at: startTs })
    .eq('id', job.id);

  const params = (job.params || {}) as DiscoveryBatchParams;

  try {
    const result = await runDiscoveryBatch(
      {
        ...params,
        max_total_candidates: WORKER_MAX_TOTAL_CANDIDATES,
      },
      {
        db,
        organisation_id: job.organisation_id as string,
        created_by_user_id: (job.created_by_user_id as string | null) ?? null,
      },
    );

    const completedTs = new Date().toISOString();
    if (result.ok) {
      // Strip the ok flag — the rest of the result IS the response body
      // that the polling endpoint returns to the UI.
      const { ok: _ok, ...resultBody } = result;
      await db
        .from('discovery_jobs')
        .update({
          status: 'completed',
          result: resultBody,
          completed_at: completedTs,
        })
        .eq('id', job.id);

      const summary = {
        ok: true,
        job_id: job.id,
        candidates_scored: result.candidates_scored,
        candidates_failed: result.candidates_failed,
        wall_time_ms: Date.now() - startedAt,
      };
      console.log(JSON.stringify({ src: 'cron:run-discovery-jobs', ...summary }));
      return NextResponse.json(summary);
    } else {
      await db
        .from('discovery_jobs')
        .update({
          status: 'failed',
          error: result.error,
          // Persist cap-exceeded payload too so the UI can render it
          // (vs. a generic "failed" message).
          result: result.cap_exceeded ? { cap_exceeded: result.cap_exceeded } : null,
          completed_at: completedTs,
        })
        .eq('id', job.id);

      console.log(JSON.stringify({
        src: 'cron:run-discovery-jobs',
        ok: false,
        job_id: job.id,
        error: result.error,
        wall_time_ms: Date.now() - startedAt,
      }));
      return NextResponse.json({ ok: false, job_id: job.id, error: result.error });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db
      .from('discovery_jobs')
      .update({
        status: 'failed',
        error: errMsg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    console.error('[cron:run-discovery-jobs] uncaught:', errMsg);
    return NextResponse.json({ ok: false, job_id: job.id, error: errMsg }, { status: 500 });
  }
}
