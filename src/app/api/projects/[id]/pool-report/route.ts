/**
 * GET /api/projects/[id]/pool-report
 *
 * Auto-generated market-research summary of the investor pool surfaced
 * for a project. Pure aggregation (no LLM call) — returns the same shape
 * the /projects/[id]/pool page renders. Useful for share / PDF export
 * paths that don't want SSR.
 *
 * Aggregation logic is shared with the product-side equivalent in
 * src/lib/pool/summary.ts so adding a new region / language / sector
 * tag updates both sides at once.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { computePoolSummary, type PoolPartner, type PoolSummary } from '@/lib/pool/summary';

export const dynamic = 'force-dynamic';

export interface ProjectPoolReport extends PoolSummary {
  project_id: string;
  project_name: string;
  generated_at: string;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: project } = await db
    .from('projects')
    .select('id, name, organisation_id')
    .eq('id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .single();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { data: partnersRaw } = await db
    .from('partners')
    .select('id, company_name, contact_name, weighted_score, category, status, source, network_distance, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .eq('project_id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  const summary = computePoolSummary((partnersRaw || []) as PoolPartner[], { kind: 'project' });

  const report: ProjectPoolReport = {
    project_id: project.id,
    project_name: project.name,
    generated_at: new Date().toISOString(),
    ...summary,
  };

  return NextResponse.json(report);
}
