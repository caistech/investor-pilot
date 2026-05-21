/**
 * POST /api/pipeline/discover-batch
 *
 * Background-job entry point for the shared discovery engine. Powers
 * "Find Buyers" on the Products page (sales side) and "Find Investors"
 * on the Projects page (funding side).
 *
 * Pattern (migration 040 `discovery_jobs`, 2026-05-21):
 *   1. Validate input + insert a pending `discovery_jobs` row.
 *   2. Fire-and-forget POST to /api/cron/run-discovery-jobs so the
 *      worker picks the job up immediately rather than waiting for
 *      the next 2-min cron tick.
 *   3. Return { ok: true, job_id } so the browser can start polling
 *      /api/pipeline/discover-jobs/[id].
 *
 * The actual discovery work runs in the cron worker against the 300s
 * function ceiling — see src/lib/discovery/runner.ts for the engine
 * and src/app/api/cron/run-discovery-jobs/route.ts for the worker.
 *
 * Why this shape:
 *   Vercel's edge gateway forcibly closes the browser TCP connection
 *   at ~60s even when the underlying serverless function is still
 *   allowed to run to 300s. Returning a job_id immediately moves the
 *   wall-time conversation to a polling endpoint where each request is
 *   sub-second. See the wall-time-discipline memory for context.
 *
 * Body:
 *   { product_id?: 'auto' | uuid, project_id?: 'auto' | uuid,
 *     query_count?: number, sources?: ('linkedin' | 'sales_nav' | 'brave')[],
 *     network_tiers?: ('1st' | '2nd' | 'cold')[], enrich_with_brave?: boolean }
 *
 * Returns:
 *   { ok: true, job_id: uuid }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import type { DiscoverSource, NetworkTier } from '@/lib/discovery/runner';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as {
    product_id?: string;
    project_id?: string;
    query_count?: number;
    sources?: DiscoverSource[];
    network_tiers?: NetworkTier[];
    enrich_with_brave?: boolean;
  };

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.organisation_id;

  // params persisted on the job row are exactly what the worker replays.
  // max_total_candidates is set by the worker (150 against the 300s
  // ceiling); not accepted from the client body to avoid clients sneaking
  // past the synchronous-route ceiling.
  const params = {
    product_id: body.product_id,
    project_id: body.project_id,
    query_count: body.query_count,
    sources: body.sources,
    network_tiers: body.network_tiers,
    enrich_with_brave: body.enrich_with_brave,
  };

  const { data: job, error: insertError } = await db
    .from('discovery_jobs')
    .insert({
      organisation_id,
      product_id: body.product_id && body.product_id !== 'auto' ? body.product_id : null,
      project_id: body.project_id && body.project_id !== 'auto' ? body.project_id : null,
      status: 'pending',
      params,
      created_by_user_id: user!.id,
    })
    .select('id')
    .single();

  if (insertError || !job) {
    return NextResponse.json(
      { error: `Failed to queue discovery job: ${insertError?.message || 'unknown'}` },
      { status: 500 },
    );
  }

  // Fire-and-forget kick to the cron worker so the job runs immediately
  // instead of waiting for the next */2-min tick. Per the kick-cron-
  // from-interactive-writes memory: never promise "in a few minutes"
  // when the cron interval is the bottleneck.
  //
  // Best-effort only — if the kick fails, the cron will still pick the
  // job up on its normal schedule. We do NOT await this; the route
  // returns the job_id immediately.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    // Don't await — fire-and-forget. Catch errors silently; the job
    // still runs on the scheduled cron tick.
    fetch(`${appUrl}/api/cron/run-discovery-jobs`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    }).catch(err => {
      console.warn('[discover-batch] cron kick failed (job will run on schedule):', err instanceof Error ? err.message : String(err));
    });
  }

  return NextResponse.json({ ok: true, job_id: job.id });
}
