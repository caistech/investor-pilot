/**
 * POST /api/projects/generate-scoring-rubric
 *
 * Project-side mirror of /api/products/generate-scoring-rubric. Generates
 * an INVESTOR ICP rubric (capital-fit, asset-class, ticket-band) tailored
 * to a fundraising vehicle. Writes scoring_rubric + icp_categories +
 * icp_partner_type + icp_reject_categories + icp_special_cases back to
 * the projects row.
 *
 * Body: { project_id: string }
 * 400 if missing thesis/description; 429 if LLM cap exhausted.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { generateInvestorScoringRubric } from '@/lib/discovery/generate-scoring-rubric';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const projectId: string | undefined = body.project_id;
  if (!projectId) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.organisation_id;

  const llmCap = await checkCap(organisation_id, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }

  const [{ data: project }, { data: kbRows }] = await Promise.all([
    db
      .from('projects')
      .select('id, organisation_id, name, description, investment_thesis, sponsor, project_type, funding_target, target_round, round_size_label, geography, asset_class, exclusions, icp_buyer_title, partner_types')
      .eq('id', projectId)
      .single(),
    db
      .from('product_sources')
      .select('title, content')
      .eq('project_id', projectId)
      .eq('processing_status', 'completed'),
  ]);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  if (project.organisation_id !== organisation_id) {
    return NextResponse.json({ error: 'Project belongs to a different organisation' }, { status: 403 });
  }

  const kb = (kbRows ?? []).filter((s) => s.content);

  let result;
  try {
    result = await generateInvestorScoringRubric(project, kb, {
      organisation_id,
      route: '/api/projects/generate-scoring-rubric',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const { error: updateError } = await db
    .from('projects')
    .update({
      scoring_rubric: result.scoring_rubric,
      icp_categories: result.icp_categories,
      icp_partner_type: result.icp_partner_type,
      icp_reject_categories: result.icp_reject_categories,
      icp_special_cases: result.icp_special_cases,
    })
    .eq('id', projectId);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to save investor rubric: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    project_id: projectId,
    scoring_rubric: result.scoring_rubric,
    icp_categories: result.icp_categories,
    icp_partner_type: result.icp_partner_type,
    icp_reject_categories: result.icp_reject_categories,
    icp_special_cases: result.icp_special_cases,
    next_step: 'Click "Find Investors" on this project to run an investor discovery batch using the new rubric.',
  });
}
