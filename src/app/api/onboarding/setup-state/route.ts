/**
 * GET /api/onboarding/setup-state
 *
 * Returns the operator's setup checklist as JSON for client components
 * that need to preemptively disable buttons depending on prerequisites
 * (e.g. /products page disabling "Generate sequence" when sender identity
 * isn't configured).
 *
 * Server components should call getSetupState() directly from
 * src/lib/onboarding/setup-state.ts — this route exists for client-side
 * pages that can't import the server-only helper.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { getSetupState, listSetupGaps } from '@/lib/onboarding/setup-state';

export async function GET() {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const state = await getSetupState(profile.active_organisation_id);
  return NextResponse.json({
    ...state,
    gaps: listSetupGaps(state),
  });
}
