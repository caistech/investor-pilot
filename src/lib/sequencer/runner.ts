/**
 * Sequencer worker — shared between the 15-minute cron and operator-
 * triggered "render now" calls from the Prospects page.
 *
 * Lives in /lib (not in a route file) because Next.js forbids exporting
 * non-handler symbols from /api/.../route.ts. The cron route is a thin
 * wrapper around runSequencer(); /api/sequences/render-now is too.
 *
 * Per CLAUDE.md: no agentic loops here. One Claude call per step (inside
 * the renderer) for credit_signal extraction. Steps are processed
 * sequentially to respect provider rate limits and keep the worker
 * debuggable.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { renderStep, resolveStepTemplate, type RenderPartner } from '@/lib/sequencer/render';
import { createOrgContextCache } from '@/lib/sequencer/context';
import { checkCompliance } from '@/lib/compliance/filter';
import { advanceAllWarmupDays } from '@/lib/channels/channel-guard';
import type { ComplianceMode } from '@/lib/compliance/rules';

const MAX_STEPS_PER_RUN = 25;

interface SequenceStepRow {
  id: string;
  organisation_id: string;
  partner_id: string;
  template_id: string;
  step_index: number;
  channel: string;
  scheduled_for: string;
}

interface TemplateRow {
  id: string;
  compliance_mode: ComplianceMode;
  steps: Array<{ step_index: number; template_key: string }>;
}

interface ChannelRow {
  id: string;
  channel_type: 'linkedin' | 'email' | 'calendar';
  status: string;
}

/**
 * Optional narrowing for operator-triggered runs ("Render now" button on
 * the Prospects page). When `partnerIds` is set, only those partners'
 * pending steps are processed. When `ignoreSchedule` is true,
 * scheduled_for is not enforced — used so the operator doesn't have to
 * wait up to 15 min for the next cron tick to render the first message.
 */
export interface RunSequencerOptions {
  partnerIds?: string[];
  ignoreSchedule?: boolean;
  organisationId?: string;
  /** Skip warmup_day tick — irrelevant for one-shot render-now calls. */
  skipWarmupTick?: boolean;
  /**
   * How many steps to process in parallel. Default 1 (matches the
   * sequential cron behaviour that respects per-provider rate limits).
   * The operator-triggered render-now route passes 4 — small batch +
   * impatient operator + Vercel's 60s function ceiling means 4 sequential
   * Claude calls regularly blow the budget. 4 in parallel completes in
   * ~max(call) rather than ~sum(calls).
   */
  concurrency?: number;
}

export async function runSequencer(opts: RunSequencerOptions = {}) {
  const db = createServiceClient();
  const startedAt = new Date().toISOString();

  // Tick warmup_day forward for every active channel based on calendar days
  // since creation. Idempotent — running every 15 min is cheap and ensures a
  // freshly-connected account ramps cap correctly without waiting for the
  // first send to trigger it. Without this, day 1's 5-connect cap stays
  // forever.
  const warmupTick = opts.skipWarmupTick ? { ticked: 0 } : await advanceAllWarmupDays(db);

  // Pull due steps. Limit per run so a backlog can't blow our LLM budget in one
  // crontick; the next tick picks up the rest.
  let dueQuery = db
    .from('sequence_steps')
    .select('id, organisation_id, partner_id, template_id, step_index, channel, scheduled_for')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(MAX_STEPS_PER_RUN);

  if (!opts.ignoreSchedule) {
    dueQuery = dueQuery.lte('scheduled_for', startedAt);
  }
  if (opts.partnerIds?.length) {
    dueQuery = dueQuery.in('partner_id', opts.partnerIds);
  }
  if (opts.organisationId) {
    dueQuery = dueQuery.eq('organisation_id', opts.organisationId);
  }

  const { data: due, error: dueErr } = await dueQuery;

  if (dueErr) {
    return NextResponse.json({ error: dueErr.message }, { status: 500 });
  }

  const rows = (due || []) as SequenceStepRow[];

  const results: Array<{
    step_id: string;
    partner_id: string;
    outcome: 'queued' | 'compliance_blocked' | 'failed' | 'skipped_no_channel';
    reason?: string;
  }> = [];

  // Per-batch cache so the per-org sender lookup hits the DB once per unique
  // organisation_id even when the cron run processes hundreds of steps.
  const orgContextCache = createOrgContextCache(db);

  // Inline-process one step. Pulled out so the outer driver can run them
  // sequentially (default cron behaviour, respects per-provider rate
  // limits) or in chunks of `concurrency` (render-now's 4-wide for the
  // operator's "do it now" button).
  async function processStep(step: SequenceStepRow) {
    try {
      // Lookup template + partner + a usable channel for this org.
      const [{ data: template }, { data: partner }, { data: channels }] = await Promise.all([
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
        db
          .from('client_channels')
          .select('id, channel_type, status')
          .eq('organisation_id', step.organisation_id)
          .eq('status', 'active'),
      ]);

      if (!template || !partner) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: 'template or partner missing' });
        return;
      }

      const tplRow = template as TemplateRow;
      const tplStep = tplRow.steps.find(s => s.step_index === step.step_index);
      if (!tplStep) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: `No template step at index ${step.step_index}` });
        return;
      }

      // Map step channel to client_channels.channel_type. LinkedIn connect +
      // LinkedIn DM both use a 'linkedin' channel row.
      const requiredChannelType =
        step.channel === 'email' ? 'email' : step.channel.startsWith('linkedin') ? 'linkedin' : null;
      if (!requiredChannelType) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: `Unsupported channel ${step.channel}` });
        return;
      }

      const channel = (channels as ChannelRow[] | null)?.find(c => c.channel_type === requiredChannelType);
      if (!channel) {
        // No active channel for this type — leave step pending so it picks up
        // once the operator connects the channel. Don't mark failed.
        results.push({
          step_id: step.id,
          partner_id: step.partner_id,
          outcome: 'skipped_no_channel',
          reason: `No active ${requiredChannelType} channel`,
        });
        return;
      }

      // Pull KB URLs scoped to this partner's project (or product if the
      // partner predates the project model). The renderer injects them via
      // the {project_urls_block} placeholder on first-touch templates.
      const projectUrlRefs = await fetchProjectUrls(db, {
        project_id: partner.project_id || null,
        product_id: partner.product_id || null,
      });

      const renderPartner: RenderPartner = {
        id: partner.id,
        company_name: partner.company_name,
        contact_name: partner.contact_name,
        contact_title: partner.contact_title,
        audience_overlap_notes: partner.audience_overlap_notes,
        complementarity_notes: partner.complementarity_notes,
        partner_readiness_notes: partner.partner_readiness_notes,
        weighted_score: partner.weighted_score,
        project_url_refs: projectUrlRefs,
        profile_recent_posts: partner.profile_recent_posts,
        profile_connected_at: partner.profile_connected_at,
        profile_shared_connections_count: partner.profile_shared_connections_count,
        profile_engagement_flags: partner.profile_engagement_flags,
        firm_recent_news: partner.firm_recent_news,
        firm_named_deals: partner.firm_named_deals,
        // Drives the fit-signal extraction prompt — investor framing for
        // project-scoped partners, partner/credit framing otherwise.
        offering_kind: partner.project_id ? 'project' : 'product',
      };

      let context;
      try {
        context = await orgContextCache.get(step.organisation_id);
      } catch (err) {
        await markStep(db, step.id, 'compliance_blocked');
        const reason = err instanceof Error ? err.message : String(err);
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'compliance_blocked', reason });
        return;
      }

      const stepTemplate = resolveStepTemplate(tplStep);
      if (!stepTemplate) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: `Unknown template_key: ${tplStep.template_key}` });
        return;
      }

      const rendered = await renderStep(tplStep.template_key, renderPartner, context, stepTemplate);

      if (!rendered.ok) {
        await markStep(db, step.id, 'compliance_blocked');
        await db.from('audit_events').insert({
          organisation_id: step.organisation_id,
          actor: 'system:sequencer',
          action: 'sequence.render_blocked',
          resource_type: 'sequence_step',
          resource_id: step.id,
          payload: { blocker: rendered.blocker, reason: rendered.reason, template_key: tplStep.template_key },
        });
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'compliance_blocked', reason: rendered.reason });
        return;
      }

      const compliance = checkCompliance(
        [rendered.subject, rendered.body].filter(Boolean).join('\n'),
        tplRow.compliance_mode,
      );

      const status = compliance.blocked ? 'compliance_blocked' : 'queued_for_approval';

      // Persist the outbound message + link it to the step in one DB chain so
      // a partial failure doesn't leave a step with no message.
      const { data: msg, error: msgErr } = await db
        .from('outbound_messages')
        .insert({
          organisation_id: step.organisation_id,
          partner_id: step.partner_id,
          sequence_step_id: step.id,
          client_channel_id: channel.id,
          channel: step.channel,
          rendered_subject: rendered.subject,
          rendered_body: rendered.body,
          evidence_refs: rendered.evidence_refs,
          compliance_check: compliance,
          personalization_score: rendered.personalization_score,
        })
        .select('id')
        .single();

      if (msgErr || !msg) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: msgErr?.message || 'insert failed' });
        return;
      }

      await db
        .from('sequence_steps')
        .update({ status, outbound_message_id: msg.id })
        .eq('id', step.id);

      await db.from('audit_events').insert({
        organisation_id: step.organisation_id,
        actor: 'system:sequencer',
        action: status === 'compliance_blocked' ? 'sequence.compliance_blocked' : 'sequence.queued_for_approval',
        resource_type: 'outbound_message',
        resource_id: msg.id,
        payload: {
          step_id: step.id,
          partner_id: step.partner_id,
          template_key: tplStep.template_key,
          compliance_flags: compliance.flags,
          personalization_score: rendered.personalization_score,
        },
      });

      results.push({
        step_id: step.id,
        partner_id: step.partner_id,
        outcome: status === 'compliance_blocked' ? 'compliance_blocked' : 'queued',
      });
    } catch (err) {
      await markStep(db, step.id, 'failed');
      results.push({
        step_id: step.id,
        partner_id: step.partner_id,
        outcome: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  if (concurrency === 1) {
    for (const step of rows) {
      await processStep(step);
    }
  } else {
    // Chunked parallelism. Each chunk awaits Promise.all before the next
    // begins — keeps the in-flight count bounded while still letting
    // small batches finish in ~max(step) instead of ~sum(step).
    for (let i = 0; i < rows.length; i += concurrency) {
      const chunk = rows.slice(i, i + concurrency);
      await Promise.all(chunk.map(processStep));
    }
  }

  return NextResponse.json({
    ok: true,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    warmup_tick: warmupTick,
    processed: results.length,
    counts: tally(results),
    results,
  });
}

function tally(rs: Array<{ outcome: string }>) {
  return rs.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] || 0) + 1;
    return acc;
  }, {});
}

async function markStep(db: ReturnType<typeof createServiceClient>, stepId: string, status: string) {
  await db
    .from('sequence_steps')
    .update({ status })
    .eq('id', stepId);
}

/**
 * Fetch completed URL-type KB sources scoped to this partner's project (or
 * product, for legacy rows). Returns the unique URL list, capped at 4 so a
 * KB with many references doesn't blow LinkedIn's char limits. Returns []
 * if the partner has no project/product linkage or no URL sources.
 */
async function fetchProjectUrls(
  db: ReturnType<typeof createServiceClient>,
  ref: { project_id: string | null; product_id: string | null },
): Promise<string[]> {
  if (!ref.project_id && !ref.product_id) return [];

  let query = db
    .from('product_sources')
    .select('url')
    .eq('source_type', 'url')
    .eq('processing_status', 'completed')
    .not('url', 'is', null);

  if (ref.project_id) {
    query = query.eq('project_id', ref.project_id);
  } else if (ref.product_id) {
    query = query.eq('product_id', ref.product_id);
  }

  const { data } = await query;
  if (!data) return [];

  const urls = data
    .map((r: { url: string | null }) => (r.url || '').trim())
    .filter((u: string) => u.length > 0);

  return Array.from(new Set(urls)).slice(0, 4);
}
