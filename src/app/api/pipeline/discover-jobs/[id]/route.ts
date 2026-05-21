/**
 * GET /api/pipeline/discover-jobs/[id]
 *
 * Polling endpoint for the background discovery-job pattern (migration
 * 040 `discovery_jobs`, 2026-05-21). The "Find Buyers" / "Find Investors"
 * button POSTs to /api/pipeline/discover-batch which returns a job_id,
 * then polls this endpoint every ~3s until status is 'completed' or
 * 'failed'.
 *
 * Returns the same response shape the old sync route used to return,
 * wrapped with the job's lifecycle metadata:
 *   {
 *     status: 'pending' | 'running' | 'completed' | 'failed',
 *     started_at: string | null,
 *     completed_at: string | null,
 *     result: <full discovery payload> | null,  // populated only on completed
 *     error: string | null,                     // populated only on failed
 *   }
 *
 * Auth: standard authenticateAndGetDb. The job must belong to the
 * caller's active organisation — verified server-side rather than
 * relying on RLS, because the service client bypasses RLS.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id, active_organisation_id')
    .eq('id', user!.id)
    .single();

  // Active org first (multi-org); fall back to legacy column for users
  // who haven't migrated yet.
  const orgId = profile?.active_organisation_id ?? profile?.organisation_id ?? null;
  if (!orgId) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const { data: job, error: lookupError } = await db
    .from('discovery_jobs')
    .select('id, status, result, error, started_at, completed_at, created_at, organisation_id')
    .eq('id', params.id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.organisation_id !== orgId) {
    // Don't leak which orgs have which jobs — return 404 not 403.
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    job_id: job.id,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    result: job.result,
    error: job.error,
  });
}
