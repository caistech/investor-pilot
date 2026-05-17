/**
 * POST /api/projects/generate-sequence
 *
 * Project-side mirror of /api/sequences/generate-from-product. Generates
 * a 6-step INVESTOR outreach sequence (credit-conversation / IC-meeting
 * tone, not sales pitch) tailored to a fundraising project.
 *
 * Body: { project_id: string }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkCap, buildCapExceededResponse } from '@/lib/usage/events';
import { generateSequenceFromProject } from '@/lib/sequencer/generate-from-product';
import { FUNDING_TYPE_BY_VALUE, type FundingType } from '@/lib/types';

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

  const [{ data: project }, { data: org }, { data: kbRows }] = await Promise.all([
    db
      .from('projects')
      .select('id, organisation_id, name, description, investment_thesis, sponsor, project_type, funding_type, funding_target, target_round, round_size_label, geography, asset_class, partner_types, icp_buyer_title, compliance_mode')
      .eq('id', projectId)
      .single(),
    db
      .from('organisations')
      .select('name, sender_name, sender_role')
      .eq('id', organisation_id)
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
  if (!org?.sender_name || !org?.sender_role) {
    return NextResponse.json(
      { error: 'Sender identity is not set. Visit /settings to fill in sender_name and sender_role before generating a sequence.' },
      { status: 400 },
    );
  }

  const kb = (kbRows ?? []).filter((s) => s.content);

  // Resolve funding_type slug → describe sentence so the generator prompt
  // gets the substantive filter rule rather than a bare slug. Same lookup
  // used by the discovery + scoring layers — keeps the three prompts
  // describing the raise consistently.
  const projectForGen = {
    ...project,
    funding_type_describe: project.funding_type
      ? FUNDING_TYPE_BY_VALUE[project.funding_type as FundingType]?.describe ?? null
      : null,
  };

  let result;
  try {
    result = await generateSequenceFromProject(
      projectForGen,
      {
        sender_name: org.sender_name,
        sender_role: org.sender_role,
        organisation_name: org.name as string,
      },
      kb,
      { organisation_id, route: '/api/projects/generate-sequence' },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Upsert on (organisation_id, vertical). Re-running for the same
  // project replaces the prior auto-generated template.
  const { data: existing } = await db
    .from('sequence_templates')
    .select('id')
    .eq('organisation_id', organisation_id)
    .eq('vertical', result.vertical)
    .maybeSingle();

  const templateRow = {
    organisation_id,
    name: result.template_name,
    description: result.template_description,
    vertical: result.vertical,
    // Compliance mode inherits from the project row (migration 026 ─
    // operators pick the appropriate ruleset per project). Fallback to
    // 'standard' (light-touch) when the column is null on legacy rows.
    compliance_mode: (project.compliance_mode as string) || 'standard',
    is_active: true,
    // Routing tag — assign-batch uses this to pick the right template
    // per partner (project-scoped partners get target_kind='project'
    // templates, product-scoped partners get target_kind='product').
    target_kind: 'project',
    steps: result.steps,
  };

  let templateId: string;
  if (existing?.id) {
    const { error: updateError } = await db
      .from('sequence_templates')
      .update({
        name: templateRow.name,
        description: templateRow.description,
        is_active: true,
        steps: templateRow.steps,
      })
      .eq('id', existing.id);
    if (updateError) {
      return NextResponse.json({ error: `Failed to update template: ${updateError.message}` }, { status: 500 });
    }
    templateId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await db
      .from('sequence_templates')
      .insert(templateRow)
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json({ error: `Failed to insert template: ${insertError?.message || 'no row returned'}` }, { status: 500 });
    }
    templateId = inserted.id;
  }

  return NextResponse.json({
    ok: true,
    template_id: templateId,
    template_name: result.template_name,
    template_description: result.template_description,
    vertical: result.vertical,
    steps_count: result.steps.length,
    next_step: 'Edit individual step copy in /settings/templates. The first investor draft will go through your normal approval queue.',
  });
}
