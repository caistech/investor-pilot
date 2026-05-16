/**
 * POST /api/cron/sequencer
 *
 * Cron worker. Finds sequence_steps in status 'pending' whose scheduled_for
 * has passed, renders the message, runs compliance, creates an
 * outbound_messages row, and transitions the step to 'queued_for_approval'
 * (or 'compliance_blocked' if the regex layer trips a block-level flag).
 *
 * Auth: Vercel cron sets `Authorization: Bearer ${CRON_SECRET}` automatically
 * when CRON_SECRET is in the project env. We require it to prevent random
 * internet POSTs from running the worker.
 *
 * GET is allowed as an alias so an operator can trigger a run manually from a
 * browser (passing ?secret=... in dev only — Vercel cron uses POST + header).
 *
 * The actual worker logic lives in src/lib/sequencer/runner.ts so the
 * operator-triggered /api/sequences/render-now route can share the same
 * code path with a narrower filter.
 */

import { NextResponse } from 'next/server';
import { runSequencer } from '@/lib/sequencer/runner';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  if (header === `Bearer ${secret}`) return true;
  // Allow ?secret= for manual browser triggering in dev. Vercel cron uses the
  // header form in prod.
  const url = new URL(request.url);
  return url.searchParams.get('secret') === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSequencer();
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSequencer();
}
