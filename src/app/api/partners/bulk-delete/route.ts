/**
 * POST /api/partners/bulk-delete
 *
 * Hard-delete the given partners. Cascades to sequence_steps + outbound_messages
 * + outreach_log via FK ON DELETE CASCADE (already on the schema). Scoped to the
 * caller's organisation — any partner_id outside the org is silently ignored.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Why hard-delete (not soft / archive): operator-flagged 2026-05-19 wants
 * dead contacts CLEARED, not hidden. The pipeline already has visibility
 * filters; the explicit ask is to remove the rows from the DB. Keep the
 * audit_events row as the durable trail.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as { partner_ids?: string[] };
  const ids = Array.isArray(body.partner_ids) ? body.partner_ids.filter(id => typeof id === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'partner_ids[] is required' }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: 'max 500 partners per request — chunk client-side' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id, active_organisation_id')
    .eq('id', user!.id)
    .single();
  const orgId = (profile?.active_organisation_id || profile?.organisation_id) as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Resolve which of the requested ids actually live in the caller's org.
  // We use this list for the delete + the audit payload — never trust the
  // client's list directly against the DB.
  const { data: ownedRows } = await db
    .from('partners')
    .select('id, company_name, contact_name')
    .eq('organisation_id', orgId)
    .in('id', ids);
  const ownedIds = (ownedRows || []).map(r => r.id as string);

  if (ownedIds.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, message: 'No matching partners in your org' });
  }

  // Audit BEFORE delete so the names survive the row removal.
  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'partners.bulk_deleted',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {
      partner_ids: ownedIds,
      sample: (ownedRows || []).slice(0, 10).map(r => ({
        id: r.id,
        company_name: r.company_name,
        contact_name: r.contact_name,
      })),
      requested_count: ids.length,
      deleted_count: ownedIds.length,
    },
  });

  const { error: deleteError, count } = await db
    .from('partners')
    .delete({ count: 'exact' })
    .in('id', ownedIds);

  if (deleteError) {
    return NextResponse.json({ error: `Delete failed: ${deleteError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? ownedIds.length });
}
