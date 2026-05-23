import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Authenticate a methodology-API request via Bearer token + return the
 * service-role Supabase client for DB access.
 *
 * The token is shared between CAS (Corporate-AI-Solutions) and IP — set as
 * METHODOLOGY_API_KEY env var on IP, INVESTORPILOT_API_KEY on CAS. Rotate by
 * updating both sides in lockstep.
 *
 * Returns either { ok: true, db } on success or { ok: false, error } on auth
 * failure / config gap.
 */
export function authenticateMethodologyApiKey(request: NextRequest):
  | { ok: true; db: ReturnType<typeof createServiceClient> }
  | { ok: false; error: NextResponse } {
  const expected = process.env.METHODOLOGY_API_KEY;
  if (!expected) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'METHODOLOGY_API_KEY not configured on server' },
        { status: 503 }
      ),
    };
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'Missing Bearer token in Authorization header' },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.slice(7).trim();
  if (token !== expected) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    };
  }

  return { ok: true, db: createServiceClient() };
}
