/**
 * POST /api/cron/sequencer
 *
 * Cron worker. Finds sequence_steps in status 'pending' whose scheduled_for has
 * passed, renders the message, runs compliance, creates an outbound_messages
 * row, and transitions the step to 'queued_for_approval' (or 'compliance_blocked'
 * if the regex layer trips a block-level flag).
 *
 * Auth: Vercel cron sets `Authorization: Bearer ${CRON_SECRET}` automatically
 * when CRON_SECRET is in the project env. We require it to prevent random
 * internet POSTs from running the worker.
 *
 * GET is allowed as an alias so an operator can trigger a run manually from a
 * browser (passing ?secret=... in dev only — Vercel cron uses POST + header).
 *
 * Per CLAUDE.md: no agentic loops here. One Claude call per step (inside the
 * renderer) for credit_signal extraction. Steps are processed sequentially to
 * respect provider rate limits and to keep the worker debuggable.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { renderStep, type RenderPartner } from '@/lib/sequencer/render';
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

async function runSequencer() {
  const db = createServiceClient();
  const startedAt = new Date().toISOString();

  // Tick warmup_day forward for every active channel based on calendar days
  // since creation. Idempotent — running every 15 min is cheap and ensures a
  // freshly-connected account ramps cap correctly without waiting for the
  // first send to trigger it. Without this, day 1's 5-connect cap stays
  // forever.
  const warmupTick = await advanceAllWarmupDays(db);

  // Pull due steps. Limit per run so a backlog can't blow our LLM budget in one
  // crontick; the next tick picks up the rest.
  const { data: due, error: dueErr } = await db
    .from('sequence_steps')
    .select('id, organisation_id, partner_id, template_id, step_index, channel, scheduled_for')
    .eq('status', 'pending')
    .lte('scheduled_for', startedAt)
    .order('scheduled_for', { ascending: true })
    .limit(MAX_STEPS_PER_RUN);

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

  for (const step of rows) {
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
          .select('id, company_name, contact_name, contact_title, audience_overlap_notes, complementarity_notes, partner_readiness_notes, weighted_score, project_id, product_id')
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
        continue;
      }

      const tplRow = template as TemplateRow;
      const tplStep = tplRow.steps.find(s => s.step_index === step.step_index);
      if (!tplStep) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: `No template step at index ${step.step_index}` });
        continue;
      }

      // Map step channel to client_channels.channel_type. LinkedIn connect +
      // LinkedIn DM both use a 'linkedin' channel row.
      const requiredChannelType =
        step.channel === 'email' ? 'email' : step.channel.startsWith('linkedin') ? 'linkedin' : null;
      if (!requiredChannelType) {
        await markStep(db, step.id, 'failed');
        results.push({ step_id: step.id, partner_id: step.partner_id, outcome: 'failed', reason: `Unsupported channel ${step.channel}` });
        continue;
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
        continue;
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
      };

      const rendered = await renderStep(tplStep.template_key, renderPartner);

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
        continue;
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
        continue;
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

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  if (header === `Bearer ${secret}`) return true;
  // Allow ?secret= for manual browser triggering in dev. Vercel cron uses the
  // header form in prod.
  const url = new URL(request.url);
  return url.searchParams.get('secret') === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSequencer();
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSequencer();
}
