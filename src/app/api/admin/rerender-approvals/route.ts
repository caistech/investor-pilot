/**
 * POST /api/admin/rerender-approvals
 *
 * One-off helper that re-renders cached approval messages with the CURRENT
 * pipeline state (enrichment, compliance regex, render prompts). Used to
 * unstick approvals that were rendered before deep-read enrichment / the
 * $-regex fix / etc. shipped.
 *
 * For each target step:
 *   1. Run full enrichment on the partner (profile + posts) if not already
 *      complete. Lets the renderer reference recent LinkedIn posts.
 *   2. Re-fetch partner with all enrichment columns.
 *   3. Re-render the step via renderStep with current prompts.
 *   4. Re-run compliance (so fixes to the soft-flag regex actually take
 *      effect on previously-flagged messages).
 *   5. UPDATE outbound_messages in place — same id, new content. The step
 *      stays queued_for_approval (or transitions to compliance_blocked if
 *      a new block-level flag fires).
 *
 * Body:
 *   { step_ids?: string[], scope?: 'queued' | 'compliance_blocked' | 'both' }
 *
 * Defaults: scope = 'both', step_ids = all in caller's org matching scope.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { renderStep, resolveStepTemplate, type RenderPartner } from '@/lib/sequencer/render';
import { createOrgContextCache } from '@/lib/sequencer/context';
import { checkCompliance } from '@/lib/compliance/filter';
import type { ComplianceMode } from '@/lib/compliance/rules';
import { enrichPartner, type OrchestratorPartner } from '@/lib/enrichment/orchestrator';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 180;

const CONCURRENCY = 4;

type Scope = 'queued' | 'compliance_blocked' | 'both';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as {
    step_ids?: string[];
    scope?: Scope;
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

  // Pre-fetch render context once (single-tenant route — orgId is constant
  // across all steps). renderStep needs sender_name/sender_role from the
  // organisations row.
  const orgContextCache = createOrgContextCache(db);
  let renderContext;
  try {
    renderContext = await orgContextCache.get(orgId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const scopeStatuses =
    body.scope === 'queued'
      ? ['queued_for_approval']
      : body.scope === 'compliance_blocked'
        ? ['compliance_blocked']
        : ['queued_for_approval', 'compliance_blocked'];

  let stepsQuery = db
    .from('sequence_steps')
    .select('id, organisation_id, partner_id, template_id, step_index, channel, outbound_message_id, status')
    .eq('organisation_id', orgId)
    .in('status', scopeStatuses);
  if (body.step_ids && body.step_ids.length > 0) {
    stepsQuery = stepsQuery.in('id', body.step_ids);
  }

  const { data: steps } = await stepsQuery;
  if (!steps || steps.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No matching steps' });
  }

  // Resolve LinkedIn account for enrichment.
  const { data: linkedinChannel } = await db
    .from('client_channels')
    .select('oauth_token_ref')
    .eq('organisation_id', orgId)
    .eq('channel_type', 'linkedin')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const linkedinAccountId = (linkedinChannel?.oauth_token_ref as string) || null;

  const startedAt = Date.now();
  const results: Array<{
    step_id: string;
    partner_id: string;
    outcome: string;
    reason?: string;
    enrichment_status?: string;
    personalization_score?: number;
    compliance_blocked?: boolean;
  }> = [];

  // Process in parallel batches.
  for (let i = 0; i < steps.length; i += CONCURRENCY) {
    const slice = steps.slice(i, i + CONCURRENCY);
    const batch = await Promise.all(slice.map(s => rerenderOneStep(db, s, linkedinAccountId, renderContext)));
    results.push(...batch);
  }

  const wallMs = Date.now() - startedAt;
  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'approvals.rerendered',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {
      processed: results.length,
      requeued: results.filter(r => r.outcome === 'rerendered').length,
      blocked: results.filter(r => r.outcome === 'compliance_blocked').length,
      failed: results.filter(r => r.outcome === 'failed').length,
      wall_time_ms: wallMs,
    },
  });

  return NextResponse.json({
    ok: true,
    processed: results.length,
    wall_time_ms: wallMs,
    summary: {
      rerendered: results.filter(r => r.outcome === 'rerendered').length,
      compliance_blocked: results.filter(r => r.outcome === 'compliance_blocked').length,
      failed: results.filter(r => r.outcome === 'failed').length,
    },
    results,
  });
}

interface StepRow {
  id: string;
  organisation_id: string;
  partner_id: string;
  template_id: string;
  step_index: number;
  channel: string;
  outbound_message_id: string | null;
  status: string;
}

async function rerenderOneStep(
  db: SupabaseClient,
  step: StepRow,
  linkedinAccountId: string | null,
  renderContext: import('@/lib/sequencer/render').RenderContext,
): Promise<{
  step_id: string;
  partner_id: string;
  outcome: string;
  reason?: string;
  enrichment_status?: string;
  personalization_score?: number;
  compliance_blocked?: boolean;
  _body_preview?: string;
  _flag_matches?: string[];
  _flag_count?: number;
}> {
  try {
    // 1. Run enrichment first so the re-render sees fresh data.
    let enrichmentStatus = 'skipped';
    if (linkedinAccountId) {
      const { data: partnerRow } = await db
        .from('partners')
        .select('id, company_name, contact_name, contact_title, contact_email, contact_linkedin, source, network_distance, evidence_enriched_at')
        .eq('id', step.partner_id)
        .single();
      if (partnerRow) {
        const orchPartner: OrchestratorPartner = {
          id: partnerRow.id as string,
          company_name: partnerRow.company_name as string,
          contact_name: (partnerRow.contact_name as string) || null,
          contact_title: (partnerRow.contact_title as string) || null,
          contact_email: (partnerRow.contact_email as string) || null,
          contact_linkedin: (partnerRow.contact_linkedin as string) || null,
          source: (partnerRow.source as OrchestratorPartner['source']) || null,
          network_distance: (partnerRow.network_distance as OrchestratorPartner['network_distance']) || null,
          // Force re-enrichment: clear the prior timestamp so the orchestrator
          // doesn't short-circuit on "already enriched". The whole point of
          // this endpoint is to refresh, including posts.
          evidence_enriched_at: null,
        };
        const r = await enrichPartner(db, orchPartner, linkedinAccountId);
        enrichmentStatus = r.status;
      }
    }

    // 2. Re-fetch partner + template + project URLs for the renderer.
    const [{ data: template }, { data: partner }] = await Promise.all([
      db
        .from('sequence_templates')
        .select('id, compliance_mode, steps')
        .eq('id', step.template_id)
        .single(),
      db
        .from('partners')
        .select('id, company_name, contact_name, contact_title, audience_overlap_notes, complementarity_notes, partner_readiness_notes, weighted_score, project_id, product_id, profile_recent_posts, profile_connected_at, profile_shared_connections_count, profile_engagement_flags, firm_recent_news, firm_named_deals')
        .eq('id', step.partner_id)
        .single(),
    ]);

    if (!template || !partner) {
      return { step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: 'template or partner missing' };
    }

    const tplStep = (template.steps as Array<{ step_index: number; template_key: string }>).find(s => s.step_index === step.step_index);
    if (!tplStep) {
      return { step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: `No template step at index ${step.step_index}` };
    }

    const projectUrlRefs = await fetchProjectUrls(db, {
      project_id: (partner.project_id as string) || null,
      product_id: (partner.product_id as string) || null,
    });

    const renderPartner: RenderPartner = {
      id: partner.id as string,
      company_name: partner.company_name as string,
      contact_name: (partner.contact_name as string) || null,
      contact_title: (partner.contact_title as string) || null,
      audience_overlap_notes: (partner.audience_overlap_notes as string) || null,
      complementarity_notes: (partner.complementarity_notes as string) || null,
      partner_readiness_notes: (partner.partner_readiness_notes as string) || null,
      weighted_score: (partner.weighted_score as number) || null,
      project_url_refs: projectUrlRefs,
      profile_recent_posts: partner.profile_recent_posts as RenderPartner['profile_recent_posts'],
      profile_connected_at: (partner.profile_connected_at as string) || null,
      profile_shared_connections_count: (partner.profile_shared_connections_count as number) || null,
      profile_engagement_flags: partner.profile_engagement_flags as RenderPartner['profile_engagement_flags'],
      firm_recent_news: partner.firm_recent_news as RenderPartner['firm_recent_news'],
      firm_named_deals: partner.firm_named_deals as RenderPartner['firm_named_deals'],
    };

    // 3. Render via current pipeline.
    const stepTemplate = resolveStepTemplate(tplStep);
    if (!stepTemplate) {
      return {
        step_id: step.id,
        partner_id: step.partner_id,
        outcome: 'failed',
        reason: `Unknown template_key: ${tplStep.template_key}`,
        enrichment_status: enrichmentStatus,
      };
    }
    const rendered = await renderStep(tplStep.template_key, renderPartner, renderContext, stepTemplate);
    if (!rendered.ok) {
      return {
        step_id: step.id,
        partner_id: step.partner_id,
        outcome: 'failed',
        reason: rendered.reason,
        enrichment_status: enrichmentStatus,
      };
    }

    // 4. Re-run compliance with current regex set.
    const compliance = checkCompliance(
      [rendered.subject, rendered.body].filter(Boolean).join('\n'),
      template.compliance_mode as ComplianceMode,
    );
    const newStatus = compliance.blocked ? 'compliance_blocked' : 'queued_for_approval';

    // 5. UPDATE the existing outbound_message in place (preserves id +
    // step linkage). If no message exists yet, INSERT one.
    if (step.outbound_message_id) {
      await db
        .from('outbound_messages')
        .update({
          rendered_subject: rendered.subject,
          rendered_body: rendered.body,
          evidence_refs: rendered.evidence_refs,
          compliance_check: compliance,
          personalization_score: rendered.personalization_score,
        })
        .eq('id', step.outbound_message_id);
    } else {
      const { data: msg } = await db
        .from('outbound_messages')
        .insert({
          organisation_id: step.organisation_id,
          partner_id: step.partner_id,
          sequence_step_id: step.id,
          channel: step.channel,
          rendered_subject: rendered.subject,
          rendered_body: rendered.body,
          evidence_refs: rendered.evidence_refs,
          compliance_check: compliance,
          personalization_score: rendered.personalization_score,
        })
        .select('id')
        .single();
      if (msg) {
        await db.from('sequence_steps').update({ outbound_message_id: msg.id }).eq('id', step.id);
      }
    }

    await db.from('sequence_steps').update({ status: newStatus }).eq('id', step.id);

    return {
      step_id: step.id,
      partner_id: step.partner_id,
      outcome: compliance.blocked ? 'compliance_blocked' : 'rerendered',
      enrichment_status: enrichmentStatus,
      personalization_score: rendered.personalization_score,
      compliance_blocked: compliance.blocked,
      // Debug fields — first 250 chars of rendered body + the actual flags
      // so we can verify the rerender produced new content without having to
      // hard-refresh the Approvals page.
      _body_preview: rendered.body.slice(0, 250),
      _flag_matches: compliance.flags.map(f => f.match),
      _flag_count: compliance.flags.length,
    };
  } catch (err) {
    return {
      step_id: step.id,
      partner_id: step.partner_id,
      outcome: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchProjectUrls(
  db: SupabaseClient,
  ref: { project_id: string | null; product_id: string | null },
): Promise<string[]> {
  if (!ref.project_id && !ref.product_id) return [];
  let query = db
    .from('product_sources')
    .select('url')
    .eq('source_type', 'url')
    .eq('processing_status', 'completed')
    .not('url', 'is', null);
  if (ref.project_id) query = query.eq('project_id', ref.project_id);
  else if (ref.product_id) query = query.eq('product_id', ref.product_id);
  const { data } = await query;
  const urls = (data || []).map((r: { url: string }) => r.url).filter(Boolean);
  return Array.from(new Set(urls)).slice(0, 4);
}
