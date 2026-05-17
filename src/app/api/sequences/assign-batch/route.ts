/**
 * POST /api/sequences/assign-batch
 *
 * Bulk-assigns multiple partners to sequences in one call. Auto-routes
 * each partner based on network_distance:
 *
 *   - 1st-degree LinkedIn connection → warm DM template (no connect step,
 *     no credit-signal gate, faster cadence)
 *   - 2nd-degree / cold / null     → cold sequence (connect → DM → email
 *     follow-ups with credit-signal extraction)
 *
 * Partners that already have live steps on the chosen template are
 * skipped with a clear reason rather than failing the whole batch. Same
 * for partners missing contact_name — they're flagged for enrichment.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Returns:
 *   {
 *     ok: true,
 *     summary: { total, assigned, skipped, errored },
 *     results: [
 *       { partner_id, partner_name, outcome: 'assigned' | 'skipped' | 'error',
 *         template_name?, reason?, sequence_step_ids? },
 *       ...
 *     ]
 *   }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { templateChannel } from '@/lib/sequencer/render';
import { enrichPartnersBatch, type OrchestratorPartner } from '@/lib/enrichment/orchestrator';

interface TemplateStep {
  step_index: number;
  channel: string;
  delay_days: number;
  template_key: string;
}

interface TemplateRow {
  id: string;
  name: string;
  steps: TemplateStep[];
  is_active: boolean;
  // Added in migration 023 — 'product' (sales partner outreach) or
  // 'project' (investor outreach). Routes templates to the right
  // partners so an investor doesn't get a channel-partner pitch.
  target_kind: 'product' | 'project' | null;
}

const TERMINAL_STATUSES = new Set([
  'sent',
  'skipped',
  'failed',
  'replied',
  'opted_out',
  'compliance_blocked',
]);

const MAX_BATCH_SIZE = 100;

// ICP-score gate — REMOVED 2026-05-17 (set to -1 so the check below is
// always falsy without restructuring the comparison code). The gating
// model is now:
//   - UI default: "Exclude out-of-scope" checkbox defaults ON, so
//     genuine-wrong-category prospects don't pollute the selectable list
//   - Assign-batch: if the operator explicitly selected a prospect
//     (overriding the default filter), we ALWAYS try to send. Tier
//     modulation in render.ts handles tone:
//       score ≥ 7   → confident tier (direct ask)
//       4 ≤ s < 7  → qualified tier (soft hedge)
//       s < 4      → exploratory tier ("not sure if this is for you but…")
// Operator philosophy: "if they get to this stage, at minimum they should
// get the 'I don't know if this is for you' email" — don't refuse to send
// what the operator deliberately queued.
const MIN_ICP_SCORE = -1;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const partnerIds = Array.isArray(body.partner_ids) ? (body.partner_ids as string[]) : [];

  if (partnerIds.length === 0) {
    return NextResponse.json({ error: 'partner_ids (non-empty array) required' }, { status: 400 });
  }
  if (partnerIds.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch size ${partnerIds.length} exceeds limit ${MAX_BATCH_SIZE}` },
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

  // Resolve all active templates for this org. We'll split them into
  // product-side vs project-side pools and pick the right one per
  // partner below. Pattern-match the warm template by name within each
  // pool (same heuristic as the per-partner recommendation logic so the
  // batch and individual flows route identically).
  const { data: templates } = await db
    .from('sequence_templates')
    .select('id, name, steps, is_active, target_kind')
    .eq('organisation_id', orgId)
    .eq('is_active', true);

  const activeTemplates = (templates || []) as TemplateRow[];

  // Pre-build per-kind pools. A template with target_kind=null (legacy or
  // freshly-seeded) falls into the 'product' pool because that was the
  // generator's only output before migration 023.
  const productPool = activeTemplates.filter(t => (t.target_kind || 'product') === 'product');
  const projectPool = activeTemplates.filter(t => t.target_kind === 'project');
  const pickWarmCold = (pool: TemplateRow[]) => ({
    warm: pool.find(t => /warm/i.test(t.name)) || null,
    cold: pool.find(t => !/warm/i.test(t.name)) || null,
  });
  const productPair = pickWarmCold(productPool);
  const projectPair = pickWarmCold(projectPool);

  // The original fall-throughs (used when a partner has no project_id
  // and no product_id, which shouldn't happen post-migration 007 but
  // sometimes does for hand-imported rows).
  const warmTemplate = productPair.warm || projectPair.warm;
  const coldTemplate = productPair.cold || projectPair.cold;

  if (!warmTemplate && !coldTemplate) {
    return NextResponse.json(
      { error: 'No active sequence templates. Seed one via /api/sequences/seed.' },
      { status: 400 },
    );
  }

  // Validate every active template's channels resolve. If a template is
  // broken at the renderer level, fail the whole batch — better to surface
  // immediately than half-assign and discover later.
  for (const tpl of activeTemplates) {
    for (const s of tpl.steps || []) {
      if (!templateChannel(s.template_key)) {
        return NextResponse.json(
          {
            error: `Template "${tpl.name}" references unknown template_key "${s.template_key}"`,
          },
          { status: 400 },
        );
      }
    }
  }

  // Fetch all selected partners in one round-trip. Filtering to this org
  // is the security boundary (RLS would also enforce it but service client
  // bypasses RLS). project_id + product_id pulled so the routing layer
  // below can pick the matching template pool per partner.
  const { data: partners } = await db
    .from('partners')
    .select('id, company_name, contact_name, contact_title, contact_email, contact_linkedin, network_distance, weighted_score, category, source, evidence_enriched_at, project_id, product_id, partner_type')
    .in('id', partnerIds)
    .eq('organisation_id', orgId);

  const partnerById = new Map((partners || []).map(p => [p.id as string, p]));

  // Evidence enrichment (migration 011, Option 1). For every partner not yet
  // enriched, fetch LinkedIn profile + recent posts (LinkedIn-sourced) or
  // Brave firm news + named deals (Brave-sourced) so the renderer has real
  // signal to personalise the warm opener / credit signal instead of
  // falling back to thin scoring-time notes. 4-wide concurrency, 8s timeout
  // per call. Failures are non-fatal — the renderer degrades gracefully.
  const enrichmentCandidates: OrchestratorPartner[] = (partners || [])
    .filter(p => !p.evidence_enriched_at)
    .filter(p => p.source && ['linkedin', 'sales_nav', 'brave'].includes(p.source as string))
    .map(p => ({
      id: p.id as string,
      company_name: p.company_name as string,
      contact_name: (p.contact_name as string) || null,
      contact_title: (p.contact_title as string) || null,
      contact_email: (p.contact_email as string) || null,
      contact_linkedin: (p.contact_linkedin as string) || null,
      source: (p.source as OrchestratorPartner['source']) || null,
      network_distance: (p.network_distance as OrchestratorPartner['network_distance']) || null,
      evidence_enriched_at: null,
    }));

  let enrichmentOutcomes: Awaited<ReturnType<typeof enrichPartnersBatch>> = [];
  if (enrichmentCandidates.length > 0) {
    // Resolve the org's LinkedIn channel account_id (oauth_token_ref). Required
    // for linkedin/sales_nav enrichment; Brave-only batches pass null.
    const { data: linkedinChannel } = await db
      .from('client_channels')
      .select('oauth_token_ref')
      .eq('organisation_id', orgId)
      .eq('channel_type', 'linkedin')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    const linkedinAccountId = (linkedinChannel?.oauth_token_ref as string) || null;

    enrichmentOutcomes = await enrichPartnersBatch(db, enrichmentCandidates, linkedinAccountId, 4);
  }

  // Look up existing live steps once for every (partner, template) pair
  // we might touch, so we can skip duplicates without per-partner queries.
  // Both pools' template IDs are included — the partner-specific routing
  // happens below, but the duplicate-step check needs to know about every
  // template we might assign across the batch.
  const templateIdsInPlay = [
    productPair.warm?.id,
    productPair.cold?.id,
    projectPair.warm?.id,
    projectPair.cold?.id,
  ].filter((id): id is string => !!id);

  const { data: existingSteps } = await db
    .from('sequence_steps')
    .select('id, partner_id, template_id, status')
    .eq('organisation_id', orgId)
    .in('partner_id', partnerIds)
    .in('template_id', templateIdsInPlay);

  const liveStepKeys = new Set<string>();
  for (const s of existingSteps || []) {
    if (!TERMINAL_STATUSES.has(s.status as string)) {
      liveStepKeys.add(`${s.partner_id}|${s.template_id}`);
    }
  }

  const now = Date.now();
  const results: Array<{
    partner_id: string;
    partner_name: string;
    outcome: 'assigned' | 'skipped' | 'error';
    template_name?: string;
    reason?: string;
    sequence_step_ids?: string[];
  }> = [];

  // Build all inserts in memory so we can do one batched insert. Per-row
  // errors are easier to surface this way than tracking individual inserts.
  const rowsToInsert: Array<{
    organisation_id: string;
    partner_id: string;
    template_id: string;
    step_index: number;
    channel: string;
    scheduled_for: string;
    status: string;
    _partner_name: string; // stripped before insert
    _template_name: string;
  }> = [];

  for (const partnerId of partnerIds) {
    const partner = partnerById.get(partnerId);
    if (!partner) {
      results.push({
        partner_id: partnerId,
        partner_name: '(unknown)',
        outcome: 'error',
        reason: 'Partner not found in your organisation',
      });
      continue;
    }
    if (!partner.contact_name) {
      results.push({
        partner_id: partnerId,
        partner_name: partner.company_name as string,
        outcome: 'skipped',
        reason: 'No contact_name on partner; run enrich first',
      });
      continue;
    }

    // ICP-score gate REMOVED 2026-05-17 — operator philosophy is "if the
    // user explicitly selected this prospect, send the exploratory-tier
    // email rather than refusing". out_of_scope filtering happens at the
    // UI layer (Exclude out-of-scope checkbox, defaulted ON). If the
    // operator unticks the filter and selects an out_of_scope row,
    // they're consciously overriding — honour that. Tier modulation in
    // render.ts ensures low-score prospects get hedged copy.
    const partnerScore = typeof partner.weighted_score === 'number' ? partner.weighted_score : null;
    if (partnerScore !== null && partnerScore < MIN_ICP_SCORE) {
      // Effectively unreachable now (MIN_ICP_SCORE = -1) but kept so the
      // gate can be reinstated by raising the constant if abuse appears.
      results.push({
        partner_id: partnerId,
        partner_name: partner.company_name as string,
        outcome: 'skipped',
        reason: `Weighted score ${partnerScore.toFixed(2)} below MIN_ICP_SCORE (${MIN_ICP_SCORE}) — genuine no-fit, not queuing`,
      });
      continue;
    }

    // Route to the matching template pool. project-scoped partners get
    // an investor-side template; product-scoped partners get a sales-side
    // template. Falls back to the other pool if the matching one is
    // empty — that surfaces as a soft warning in `reason` so the
    // operator knows to generate the missing sequence rather than
    // silently sending the wrong message type.
    //
    // Routing order (most explicit → most inferential):
    //   1. partner.project_id set     → project pool
    //   2. partner.product_id set     → product pool
    //   3. partner_type ∈ investor/   → project pool (legacy / seeded
    //      lender/funder                rows from the 482-prospect CSV
    //                                   import have project_id=null even
    //                                   when they're clearly investors)
    //   4. partner_type ∈ partner/    → product pool
    //      buyer/client
    //   5. fallback                   → product pool (preserves prior
    //                                   behaviour for genuinely unknown rows)
    const PROJECT_TYPES = new Set(['investor', 'lender', 'funder']);
    const PRODUCT_TYPES = new Set(['partner', 'buyer', 'client']);
    const partnerKind: 'product' | 'project' = (() => {
      if (partner.project_id) return 'project';
      if (partner.product_id) return 'product';
      const pt = typeof partner.partner_type === 'string' ? partner.partner_type.toLowerCase() : '';
      if (PROJECT_TYPES.has(pt)) return 'project';
      if (PRODUCT_TYPES.has(pt)) return 'product';
      return 'product';
    })();
    const matchingPair = partnerKind === 'project' ? projectPair : productPair;
    const fallbackPair = partnerKind === 'project' ? productPair : projectPair;

    const useWarm = partner.network_distance === '1st';
    let chosen = useWarm
      ? matchingPair.warm || matchingPair.cold
      : matchingPair.cold || matchingPair.warm;
    let usedFallback = false;
    if (!chosen) {
      chosen = useWarm
        ? fallbackPair.warm || fallbackPair.cold
        : fallbackPair.cold || fallbackPair.warm;
      usedFallback = !!chosen;
    }

    if (!chosen) {
      results.push({
        partner_id: partnerId,
        partner_name: partner.company_name as string,
        outcome: 'skipped',
        reason: `No ${partnerKind}-side sequence template exists yet — generate one on the ${partnerKind === 'project' ? 'project card' : 'product card'} first`,
      });
      continue;
    }
    if (usedFallback) {
      // Don't block the assignment — but flag clearly that the operator
      // is going to get the wrong message tone for this partner type.
      results.push({
        partner_id: partnerId,
        partner_name: partner.company_name as string,
        outcome: 'skipped',
        reason: `No ${partnerKind}-side template exists — would have used "${chosen.name}" (${partnerKind === 'project' ? 'sales' : 'investor'}-side) which is the wrong tone for a ${partnerKind === 'project' ? 'project' : 'product'} prospect. Generate a matching sequence first.`,
      });
      continue;
    }

    if (liveStepKeys.has(`${partnerId}|${chosen.id}`)) {
      results.push({
        partner_id: partnerId,
        partner_name: partner.company_name as string,
        outcome: 'skipped',
        reason: `Already has live steps on "${chosen.name}"`,
        template_name: chosen.name,
      });
      continue;
    }

    for (const s of chosen.steps || []) {
      rowsToInsert.push({
        organisation_id: orgId,
        partner_id: partnerId,
        template_id: chosen.id,
        step_index: s.step_index,
        channel: s.channel,
        scheduled_for: new Date(now + s.delay_days * 86400 * 1000).toISOString(),
        status: 'pending',
        _partner_name: partner.company_name as string,
        _template_name: chosen.name,
      });
    }
  }

  if (rowsToInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: tallyResults(results, 0),
      results,
    });
  }

  // Strip the helper fields before insert (Supabase rejects unknown columns).
  // created_by_user_id (migration 028) attributes each step to the operator
  // who triggered the batch, so the sequencer picks THIS user's channels
  // at send time rather than any org-wide channel.
  const cleanRows = rowsToInsert.map(r => ({
    organisation_id: r.organisation_id,
    partner_id: r.partner_id,
    template_id: r.template_id,
    step_index: r.step_index,
    channel: r.channel,
    scheduled_for: r.scheduled_for,
    status: r.status,
    created_by_user_id: user!.id,
  }));

  const { data: inserted, error: insertError } = await db
    .from('sequence_steps')
    .insert(cleanRows)
    .select('id, partner_id, template_id, step_index');

  if (insertError) {
    return NextResponse.json(
      { error: `Insert failed: ${insertError.message}` },
      { status: 500 },
    );
  }

  // Group inserted step IDs back to their partner so the result line for
  // each assigned partner lists its concrete step IDs.
  const stepsByPartner = new Map<string, string[]>();
  for (const row of inserted || []) {
    const partnerId = row.partner_id as string;
    const list = stepsByPartner.get(partnerId) || [];
    list.push(row.id as string);
    stepsByPartner.set(partnerId, list);
  }

  // Backfill 'assigned' result rows in the order of rowsToInsert.
  const seenAssigned = new Set<string>();
  for (const r of rowsToInsert) {
    if (seenAssigned.has(r.partner_id)) continue;
    seenAssigned.add(r.partner_id);
    results.push({
      partner_id: r.partner_id,
      partner_name: r._partner_name,
      outcome: 'assigned',
      template_name: r._template_name,
      sequence_step_ids: stepsByPartner.get(r.partner_id) || [],
    });
  }

  // Audit-log the whole batch. One row keeps the audit trail compact;
  // individual step IDs are in the payload for downstream investigation.
  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'sequence.assigned_batch',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {
      batch_size: partnerIds.length,
      assigned_count: seenAssigned.size,
      total_step_rows: inserted?.length || 0,
      template_ids_used: Array.from(new Set(rowsToInsert.map(r => r.template_id))),
      enrichment: {
        attempted: enrichmentOutcomes.length,
        success: enrichmentOutcomes.filter(o => o.status === 'success').length,
        partial: enrichmentOutcomes.filter(o => o.status === 'partial').length,
        failed: enrichmentOutcomes.filter(o => o.status === 'failed').length,
        unavailable: enrichmentOutcomes.filter(o => o.status === 'unavailable').length,
        emails_backfilled: enrichmentOutcomes.filter(o => o.email_backfilled).length,
        posts_fetched_total: enrichmentOutcomes.reduce((sum, o) => sum + o.posts_fetched_count, 0),
      },
    },
  });

  return NextResponse.json({
    ok: true,
    summary: tallyResults(results, inserted?.length || 0),
    results,
  });
}

function tallyResults(
  results: Array<{ outcome: 'assigned' | 'skipped' | 'error' }>,
  totalSteps: number,
) {
  const summary = { total: results.length, assigned: 0, skipped: 0, errored: 0, total_steps: totalSteps };
  for (const r of results) {
    if (r.outcome === 'assigned') summary.assigned += 1;
    else if (r.outcome === 'skipped') summary.skipped += 1;
    else summary.errored += 1;
  }
  return summary;
}
