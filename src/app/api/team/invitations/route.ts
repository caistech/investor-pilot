/**
 * GET /api/team/invitations
 *
 * List pending (non-accepted, non-revoked, non-expired) invitations for
 * the caller's active organisation. Used by /settings/team to display
 * the "Pending invitations" section so admins can see who they've
 * invited and revoke if needed.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, orgId, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 400 });

  const { data: invitations } = await db!
    .from('org_invitations')
    .select('id, token, email, role, invited_by, created_at, expires_at')
    .eq('organisation_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  return NextResponse.json({ invitations: invitations ?? [] });
}
