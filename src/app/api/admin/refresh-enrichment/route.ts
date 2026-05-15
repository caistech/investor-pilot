/**
 * POST /api/admin/refresh-enrichment
 *
 * One-off backfill helper. Runs the enrichment orchestrator (profile-only
 * mode by default) on unenriched LinkedIn-sourced partners in the caller's
 * organisation. Used to backfill rows that were discovered before discovery-
 * time profile enrichment was wired in.
 *
 * Body:
 *   {
 *     partner_ids?: string[]      // restrict to specific rows; otherwise all unenriched
 *     full?: boolean              // run full enrichment (profile + posts) instead of
 *                                 // profile-only. Defaults to false (faster).
 *     limit?: number              // cap at N partners to keep one call manageable
 *   }
 *
 * Returns counts + per-partner outcomes. Idempotent — the orchestrator skips
 * rows whose evidence_enriched_at is already set (full mode marks them).
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { enrichPartnersBatch, type OrchestratorPartner } from '@/lib/enrichment/orchestrator';

export const maxDuration = 120;

const DEFAULT_LIMIT = 50;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as {
    partner_ids?: string[];
    full?: boolean;
    limit?: number;
  };

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const orgId = profile.organisation_id;

  // Find candidates. partner_ids explicit list wins; otherwise pull all
  // LinkedIn-sourced rows in the org that lack a usable company_name
  // backfill (signal: company_name == contact_name).
  let query = db
    .from('partners')
    .select('id, company_name, contact_name, contact_title, contact_email, contact_linkedin, network_distance, source, evidence_enriched_at')
    .eq('organisation_id', orgId)
    .in('source', ['linkedin', 'sales_nav'])
    .not('contact_linkedin', 'is', null);

  if (body.partner_ids && body.partner_ids.length > 0) {
    query = query.in('id', body.partner_ids);
  } else {
    // No explicit IDs — find rows that need profile-only backfill (no
    // evidence_enriched_at set, regardless of partial vs unstarted).
    query = query.is('evidence_enriched_at', null);
  }

  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, 100);
  query = query.limit(limit);

  const { data: rows } = await query;
  const candidates: OrchestratorPartner[] = (rows || []).map(p => ({
    id: p.id as string,
    company_name: p.company_name as string,
    contact_name: (p.contact_name as string) || null,
    contact_title: (p.contact_title as string) || null,
    contact_email: (p.contact_email as string) || null,
    contact_linkedin: (p.contact_linkedin as string) || null,
    source: (p.source as OrchestratorPartner['source']) || null,
    network_distance: (p.network_distance as OrchestratorPartner['network_distance']) || null,
    evidence_enriched_at: (p.evidence_enriched_at as string) || null,
  }));

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      candidates_found: 0,
      message: 'No matching partners to enrich',
    });
  }

  // Resolve LinkedIn channel account_id.
  const { data: channel } = await db
    .from('client_channels')
    .select('oauth_token_ref')
    .eq('organisation_id', orgId)
    .eq('channel_type', 'linkedin')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const linkedinAccountId = (channel?.oauth_token_ref as string) || null;
  if (!linkedinAccountId) {
    return NextResponse.json(
      { error: 'No active LinkedIn channel — connect one before running enrichment' },
      { status: 400 },
    );
  }

  const profileOnly = body.full !== true;
  const startedAt = Date.now();
  const outcomes = await enrichPartnersBatch(db, candidates, linkedinAccountId, 8, { profileOnly });
  const wallMs = Date.now() - startedAt;

  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'enrichment.refresh',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {
      profile_only: profileOnly,
      candidates: candidates.length,
      success: outcomes.filter(o => o.status === 'success').length,
      partial: outcomes.filter(o => o.status === 'partial').length,
      failed: outcomes.filter(o => o.status === 'failed').length,
      unavailable: outcomes.filter(o => o.status === 'unavailable').length,
      emails_backfilled: outcomes.filter(o => o.email_backfilled).length,
      wall_time_ms: wallMs,
    },
  });

  return NextResponse.json({
    ok: true,
    profile_only: profileOnly,
    candidates_found: candidates.length,
    wall_time_ms: wallMs,
    summary: {
      success: outcomes.filter(o => o.status === 'success').length,
      partial: outcomes.filter(o => o.status === 'partial').length,
      failed: outcomes.filter(o => o.status === 'failed').length,
      unavailable: outcomes.filter(o => o.status === 'unavailable').length,
      emails_backfilled: outcomes.filter(o => o.email_backfilled).length,
    },
    outcomes: outcomes.map(o => ({
      partner_id: o.partner_id,
      partner_name: o.partner_name,
      source_used: o.source_used,
      status: o.status,
      profile_fetched: o.profile_fetched,
      email_backfilled: o.email_backfilled,
      message: o.message,
    })),
  });
}
