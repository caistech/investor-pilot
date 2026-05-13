/**
 * POST /api/sequences/assign
 *
 * Assign a partner to a sequence template. Materialises one sequence_steps row
 * per step in the template, with scheduled_for = now() + delay_days.
 *
 * Idempotent: rejects if the partner already has any non-terminal steps on this
 * template. To re-run, terminate the existing steps first (manual op for Sprint 1).
 *
 * Body:
 *   { partner_id: uuid, template_id: uuid }
 *
 * Returns: { ok, sequence_step_ids: string[] } or { error, status }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { templateChannel } from '@/lib/sequencer/render';

interface TemplateStep {
  step_index: number;
  channel: string;
  delay_days: number;
  template_key: string;
  description?: string;
}

const TERMINAL_STATUSES = new Set([
  'sent',
  'skipped',
  'failed',
  'replied',
  'opted_out',
  'compliance_blocked',
]);

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const { partner_id, template_id } = body as { partner_id?: string; template_id?: string };

  if (!partner_id || !template_id) {
    return NextResponse.json({ error: 'partner_id and template_id required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Verify partner + template belong to this org. Using two reads rather than a
  // join — clearer error messages, and the org filter on both is the security
  // boundary regardless.
  const [{ data: partner }, { data: template }] = await Promise.all([
    db
      .from('partners')
      .select('id, company_name, contact_name')
      .eq('id', partner_id)
      .eq('organisation_id', profile.organisation_id)
      .maybeSingle(),
    db
      .from('sequence_templates')
      .select('id, name, steps, is_active')
      .eq('id', template_id)
      .eq('organisation_id', profile.organisation_id)
      .maybeSingle(),
  ]);

  if (!partner) return NextResponse.json({ error: 'Partner not found in your organisation' }, { status: 404 });
  if (!template) return NextResponse.json({ error: 'Template not found in your organisation' }, { status: 404 });
  if (!template.is_active) {
    return NextResponse.json({ error: 'Template is not active' }, { status: 400 });
  }
  if (!partner.contact_name) {
    return NextResponse.json(
      { error: 'Partner has no contact_name; run enrich first so we have a {first_name} to personalise on' },
      { status: 400 }
    );
  }

  const steps = (template.steps as TemplateStep[]) || [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return NextResponse.json({ error: 'Template has no steps' }, { status: 400 });
  }

  // Validate every step's channel resolves through our renderer. Catching here
  // is cheaper than discovering it 14 days into the sequence.
  for (const s of steps) {
    if (!templateChannel(s.template_key)) {
      return NextResponse.json(
        { error: `Template references unknown template_key "${s.template_key}" — renderer cannot handle it` },
        { status: 400 }
      );
    }
  }

  // Idempotency: refuse if the partner has any non-terminal steps on this template.
  const { data: existing } = await db
    .from('sequence_steps')
    .select('id, status')
    .eq('organisation_id', profile.organisation_id)
    .eq('partner_id', partner_id)
    .eq('template_id', template_id);

  const liveSteps = (existing || []).filter(s => !TERMINAL_STATUSES.has(s.status));
  if (liveSteps.length > 0) {
    return NextResponse.json(
      {
        error: `Partner already has ${liveSteps.length} live step(s) on this template`,
        existing_step_ids: liveSteps.map(s => s.id),
      },
      { status: 409 }
    );
  }

  const now = Date.now();
  const rowsToInsert = steps.map(s => ({
    organisation_id: profile.organisation_id,
    partner_id,
    template_id,
    step_index: s.step_index,
    channel: s.channel,
    scheduled_for: new Date(now + s.delay_days * 86400 * 1000).toISOString(),
    status: 'pending',
  }));

  const { data: inserted, error: insertError } = await db
    .from('sequence_steps')
    .insert(rowsToInsert)
    .select('id, step_index, scheduled_for');

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'sequence.assigned',
    resource_type: 'partner',
    resource_id: partner_id,
    payload: {
      template_id,
      template_name: template.name,
      step_count: steps.length,
      sequence_step_ids: (inserted || []).map(s => s.id),
    },
  });

  return NextResponse.json({
    ok: true,
    template_name: template.name,
    sequence_step_ids: (inserted || []).map(s => s.id),
    steps: inserted,
  });
}
