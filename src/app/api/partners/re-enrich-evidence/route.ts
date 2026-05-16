/**
 * POST /api/partners/re-enrich-evidence
 *
 * Operator-triggered re-fetch of Brave firm news / LinkedIn profile +
 * posts for the selected partners. Clears `evidence_enriched_at` first
 * so the orchestrator treats them as fresh.
 *
 * Use case: render-now reported "blocked because the partner has no
 * Brave/LinkedIn evidence yet" — the operator clicks this, evidence
 * refreshes, then they Reset → Assign → Render again and the renderer
 * has signal to ground the credit_signal in.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Returns:
 *   { ok: true, attempted: number, enriched: number, skipped: number, failed: number, results: [...] }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { enrichPartnersBatch, type OrchestratorPartner } from '@/lib/enrichment/orchestrator';

export const maxDuration = 60;

const MAX_PARTNERS = 10;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  const partnerIds: string[] = Array.isArray(body?.partner_ids) ? body.partner_ids : [];
  if (partnerIds.length === 0) {
    return NextResponse.json({ error: 'partner_ids (non-empty array) required' }, { status: 400 });
  }
  if (partnerIds.length > MAX_PARTNERS) {
    return NextResponse.json(
      { error: `Batch size ${partnerIds.length} exceeds limit ${MAX_PARTNERS} — re-enrich runs LinkedIn+Brave per partner and adds up fast` },
      { status: 400 },
    );
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const orgId = profile.organisation_id;

  // Org-scope defensively.
  const { data: partners } = await db
    .from('partners')
    .select('id, company_name, contact_name, contact_title, contact_email, contact_linkedin, source, network_distance')
    .in('id', partnerIds)
    .eq('organisation_id', orgId);

  const allowed = (partners || []) as OrchestratorPartner[];
  if (allowed.length === 0) {
    return NextResponse.json({ error: 'None of the supplied partners belong to your organisation' }, { status: 403 });
  }

  // Clear evidence_enriched_at first so the orchestrator's skip-if-fresh
  // check passes. Also blank the existing payload so a partial re-fetch
  // doesn't leave stale fields mixed with fresh ones.
  const { error: clearError } = await db
    .from('partners')
    .update({
      evidence_enriched_at: null,
      profile_recent_posts: null,
      firm_recent_news: null,
      firm_named_deals: null,
    })
    .in('id', allowed.map((p) => p.id))
    .eq('organisation_id', orgId);
  if (clearError) {
    return NextResponse.json({ error: `Failed to clear evidence: ${clearError.message}` }, { status: 500 });
  }

  // Resolve org's LinkedIn channel for LinkedIn-source partners.
  const { data: linkedinChannel } = await db
    .from('client_channels')
    .select('oauth_token_ref')
    .eq('organisation_id', orgId)
    .eq('channel_type', 'linkedin')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const linkedinAccountId = (linkedinChannel?.oauth_token_ref as string) || null;

  // Re-run the orchestrator. Mark each partner's enriched_at as null in
  // the input so the orchestrator doesn't short-circuit.
  const fresh: OrchestratorPartner[] = allowed.map((p) => ({ ...p, evidence_enriched_at: null }));
  const outcomes = await enrichPartnersBatch(db, fresh, linkedinAccountId, 4);

  const enriched = outcomes.filter((o) => o.status === 'success' || o.status === 'partial').length;
  const failed = outcomes.filter((o) => o.status === 'failed').length;
  const skipped = outcomes.filter((o) => o.source_used === 'skipped' || o.status === 'unavailable').length;

  return NextResponse.json({
    ok: true,
    attempted: outcomes.length,
    enriched,
    skipped,
    failed,
    results: outcomes,
  });
}
