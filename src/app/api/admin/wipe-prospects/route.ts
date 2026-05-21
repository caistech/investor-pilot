/**
 * POST /api/admin/wipe-prospects
 *
 * DESTRUCTIVE. Org-scoped reset for prospect + messaging data, intended for
 * clean-slate restarts (e.g. after a discovery pipeline overhaul where the
 * existing rows are a mess of contaminated / pre-fix data).
 *
 * Wipes (in FK-safe order, scoped to caller's org):
 *   - outbound_messages
 *   - sequence_steps
 *   - inbound_messages
 *   - outreach_log (legacy email log)
 *   - session_events (per-partner timeline events)
 *   - partners
 *   - discovery_runs
 *
 * KEEPS:
 *   - organisations / profiles (your account)
 *   - products / projects (offering definitions)
 *   - product_sources (Knowledge Base)
 *   - client_channels (connected LinkedIn / Gmail accounts)
 *   - sequence_templates (warm + cold sequence definitions)
 *   - audit_events (historical audit trail — including the wipe itself)
 *
 * Requires explicit confirmation: { "confirm": "YES" } in body. Anything
 * else returns a dry-run with counts only. Logs the operation to
 * audit_events so the historical trail records the reset.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as { confirm?: string };
  const confirmed = body.confirm === 'YES';

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const orgId = profile.active_organisation_id;

  // Always compute counts first (acts as a dry-run preview).
  const counts = await tally(db, orgId);

  if (!confirmed) {
    return NextResponse.json({
      ok: false,
      dry_run: true,
      message: 'Pass { "confirm": "YES" } to actually delete. This response shows what WOULD be deleted.',
      organisation_id: orgId,
      would_delete: counts,
    });
  }

  // Delete in FK-safe order. partners is referenced by most other tables, so
  // child rows go first. Each .delete().eq() is a single DB round-trip; the
  // whole sequence is well under maxDuration even for big orgs.
  const startedAt = Date.now();
  const deleted: Record<string, number | string> = {};

  // outbound_messages → references sequence_steps + partners
  deleted.outbound_messages = await deleteScoped(db, 'outbound_messages', 'organisation_id', orgId);

  // sequence_steps → references partners + templates
  deleted.sequence_steps = await deleteScoped(db, 'sequence_steps', 'organisation_id', orgId);

  // inbound_messages → references partners (org-scoped column exists)
  deleted.inbound_messages = await deleteScoped(db, 'inbound_messages', 'organisation_id', orgId);

  // outreach_log → legacy email log, org-scoped
  deleted.outreach_log = await deleteScoped(db, 'outreach_log', 'organisation_id', orgId);

  // session_events doesn't have organisation_id directly — scope via partner_id
  const { data: partnerIds } = await db
    .from('partners')
    .select('id')
    .eq('organisation_id', orgId);
  const ids = (partnerIds || []).map((p: { id: string }) => p.id);
  if (ids.length > 0) {
    const { error: sessionErr, count } = await db
      .from('session_events')
      .delete({ count: 'exact' })
      .in('partner_id', ids);
    deleted.session_events = sessionErr ? `error: ${sessionErr.message}` : (count ?? 0);
  } else {
    deleted.session_events = 0;
  }

  // partners → after all children
  deleted.partners = await deleteScoped(db, 'partners', 'organisation_id', orgId);

  // discovery_runs → after partners (partners.first_seen_in_run_id is SET NULL
  // on delete, so this is just for cleanliness — orphan runs aren't harmful)
  deleted.discovery_runs = await deleteScoped(db, 'discovery_runs', 'organisation_id', orgId);

  const wallMs = Date.now() - startedAt;

  // Audit-log the wipe. Use the same audit_events table that we deliberately
  // didn't wipe — leaves a clear "we did the reset" marker for the future.
  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'admin.prospects_wiped',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {
      counts_before: counts,
      counts_after_delete: deleted,
      wall_time_ms: wallMs,
    },
  });

  return NextResponse.json({
    ok: true,
    dry_run: false,
    organisation_id: orgId,
    wall_time_ms: wallMs,
    deleted,
    message: 'Prospects + messaging data wiped. Products, projects, KB sources, channels, sequence templates, and audit history are preserved.',
  });
}

async function tally(db: SupabaseClient, orgId: string) {
  const tables = ['outbound_messages', 'sequence_steps', 'inbound_messages', 'outreach_log', 'partners', 'discovery_runs'];
  const result: Record<string, number | string> = {};
  await Promise.all(
    tables.map(async (t) => {
      const { count, error } = await db.from(t).select('id', { count: 'exact', head: true }).eq('organisation_id', orgId);
      result[t] = error ? `error: ${error.message}` : (count ?? 0);
    }),
  );
  // session_events scoped via partner_id
  const { data: partnerIds } = await db.from('partners').select('id').eq('organisation_id', orgId);
  const ids = (partnerIds || []).map((p: { id: string }) => p.id);
  if (ids.length > 0) {
    const { count } = await db.from('session_events').select('id', { count: 'exact', head: true }).in('partner_id', ids);
    result.session_events = count ?? 0;
  } else {
    result.session_events = 0;
  }
  return result;
}

async function deleteScoped(
  db: SupabaseClient,
  table: string,
  scopeColumn: string,
  scopeValue: string,
): Promise<number | string> {
  const { error, count } = await db
    .from(table)
    .delete({ count: 'exact' })
    .eq(scopeColumn, scopeValue);
  if (error) return `error: ${error.message}`;
  return count ?? 0;
}
