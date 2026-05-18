import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Authenticate the request and return user + service client + active-org
 * context. The service client bypasses RLS — every query in API routes
 * MUST scope by orgId explicitly (multi-org makes this the perimeter).
 *
 * orgId + role are resolved from the user's profiles.active_organisation_id
 * (which middleware keeps in sync with /org/[slug]/* URLs) and the
 * memberships row for that org. Returns null orgId/role when the user has
 * no memberships yet (first-time signup before onboarding completes).
 */
export async function authenticateAndGetDb() {
  const authClient = createClient();
  const { data: { user } } = await authClient.auth.getUser();

  if (!user) {
    return {
      user: null,
      db: null,
      orgId: null,
      role: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const db = createServiceClient();

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .maybeSingle();

  const orgId = profile?.active_organisation_id ?? null;
  let role: string | null = null;

  if (orgId) {
    const { data: membership } = await db
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('organisation_id', orgId)
      .maybeSingle();
    role = membership?.role ?? null;
  }

  return { user, db, orgId, role, error: null };
}
