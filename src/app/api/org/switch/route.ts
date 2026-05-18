/**
 * POST /api/org/switch
 *
 * Switch the user's active organisation. Updates
 * profiles.active_organisation_id so the next-minted JWT carries the
 * new app.active_org_id claim, then forces a session refresh so the
 * client picks up the new token immediately.
 *
 * Body: { organisation_id: UUID }
 * Returns: { ok: true, redirect: '/org/<slug>/dashboard' }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { organisation_id } = (await request.json()) as { organisation_id?: string };
  if (!organisation_id) {
    return NextResponse.json({ error: 'organisation_id required' }, { status: 400 });
  }

  const { data: membership } = await db!
    .from('memberships')
    .select('role')
    .eq('user_id', user!.id)
    .eq('organisation_id', organisation_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 });
  }

  const { error: updateError } = await db!
    .from('profiles')
    .update({ active_organisation_id: organisation_id })
    .eq('id', user!.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: org } = await db!
    .from('organisations')
    .select('slug')
    .eq('id', organisation_id)
    .single();

  const authClient = createClient();
  await authClient.auth.refreshSession();

  return NextResponse.json({
    ok: true,
    redirect: `/org/${org?.slug}/dashboard`,
  });
}
