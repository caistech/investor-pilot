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
    // Pass the underlying message through verbatim — the generator now
    // translates AbortSignal timeouts into operator-readable copy before
    // throwing, so this is already actionable when it surfaces.
    const message = err instanceof Error ? err.message : String(err);
    // 504-shaped errors (timeout / abort) are user-recoverable (retry);
    // everything else is a 502 (upstream LLM failure).
    const isTimeout = /aborted|timeout|took longer than/i.test(message);
    return NextResponse.json(
      { error: message, retryable: isTimeout },
      { status: isTimeout ? 504 : 502 },
    );
  }

  // Pin the vertical slug deterministically to the project so re-running
  // ALWAYS finds and updates the same template row. The LLM-supplied
  // result.vertical was being different per run (vc_series_a_sea →
  // vc_series_a_edtech_vietnam → seed_safe_b2b_saas_sea → ...) so the
  // upsert key (organisation_id, vertical) never matched and templates
  // accumulated. An operator hit this on 2026-05-17 with 9 stacked
  // LingoPure templates. The LLM's vertical is kept in description so
  // operators can still see what the model thought the category was.
  const deterministicVertical = `auto_project_${projectId}`;
  const llmVertical = result.vertical;

  // Regeneration behaviour: deactivate any currently-active template
  // for this project, then INSERT a new active one. The deactivated
  // row stays in /settings/templates so the operator can:
  //   - compare new vs previous side-by-side
  //   - reactivate the old one if the new generation is worse
  //   - keep any manual edits they'd made to the previous step bodies
  // No prospects are affected — assign-batch filters by is_active=true,
  // so deactivated templates are invisible to routing, and any
  // sequence_steps already pointing at the old template_id keep
  // working (the deactivated row is still in the DB).
  //
  // Switched from overwrite-in-place to deactivate-and-create on
  // 2026-05-17 after operator asked to preserve audit trail + manual
  // edits across regenerations.
  const { data: previousActive } = await db
    .from('sequence_templates')
    .select('id, name')
    .eq('organisation_id', organisation_id)
    .eq('vertical', deterministicVertical)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousActive?.id) {
    // Prefix with [Previous] + timestamp so it's obvious in the
    // templates list which row is old. Skip the prefix if it's
    // already there (operator regenerated multiple times — don't
    // stack "[Previous] [Previous] [Previous] ...").
    const prevName = previousActive.name as string;
    const stampedName = /^\[Previous /.test(prevName)
      ? prevName
      : `[Previous ${new Date().toISOString().slice(0, 10)}] ${prevName}`;
    const { error: deactivateError } = await db
      .from('sequence_templates')
      .update({ is_active: false, name: stampedName })
      .eq('id', previousActive.id);
    if (deactivateError) {
      return NextResponse.json({ error: `Failed to deactivate previous template: ${deactivateError.message}` }, { status: 500 });
    }
  }

  const templateRow = {
    organisation_id,
    name: result.template_name,
    description: result.template_description
      ? `${result.template_description}${llmVertical && llmVertical !== deterministicVertical ? ` (LLM category: ${llmVertical})` : ''}`
      : null,
    vertical: deterministicVertical,
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

  const { data: inserted, error: insertError } = await db
    .from('sequence_templates')
    .insert(templateRow)
    .select('id')
    .single();
  if (insertError || !inserted) {
    return NextResponse.json({ error: `Failed to insert template: ${insertError?.message || 'no row returned'}` }, { status: 500 });
  }
  const templateId = inserted.id;

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
