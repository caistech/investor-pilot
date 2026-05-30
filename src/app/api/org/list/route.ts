/**
 * GET /api/org/list
 *
 * Returns every organisation the caller has a memberships row in,
 * with name + slug + role. Used by the sidebar org switcher.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, db, orgId: activeOrgId, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: memberships } = await db!
    .from('memberships')
    .select('organisation_id, role')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: true });

  const orgIds = (memberships || []).map((m) => m.organisation_id);
  if (orgIds.length === 0) {
    return NextResponse.json({ organisations: [], active_organisation_id: activeOrgId });
  }

  const { data: orgs } = await db!
    .from('organisations')
    .select('id, name, slug')
    .in('id', orgIds);

  const orgsById = new Map((orgs || []).map((o) => [o.id, o]));

  const result = (memberships || []).map((m) => {
    const o = orgsById.get(m.organisation_id);
    return {
      id: m.organisation_id,
      name: o?.name ?? 'Unknown organisation',
      slug: o?.slug ?? null,
      role: m.role,
      is_active: m.organisation_id === activeOrgId,
    };
  });

  console.log('[org/list] Returning orgs:', JSON.stringify({ orgCount: result.length, activeOrgId, orgs: result.map(r => ({ id: r.id, name: r.name, slug: r.slug })) }));
  
  return NextResponse.json({
    organisations: result,
    active_organisation_id: activeOrgId,
  });
}
