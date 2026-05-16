/**
 * PATCH /api/settings/templates
 *
 * Updates the inline content (subject + body) for a single step inside a
 * sequence_templates row's steps[] JSONB array. Phase D — operator can
 * customise each step body without code edits; renderer reads from the
 * step content (with SEED_TEMPLATES fallback).
 *
 * Body shape:
 *   {
 *     template_id: string,
 *     step_index: number,
 *     subject?: string | null,
 *     body?: string,
 *   }
 *
 * The step is matched by step_index; channel/delay_days/template_key/
 * is_warm/max_chars are NOT editable here (they're structural and changing
 * them would require coordinated migration of in-flight sequence_steps).
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

interface PatchBody {
  template_id?: string;
  step_index?: number;
  subject?: string | null;
  body?: string;
}

export async function PATCH(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  if (!body.template_id || typeof body.step_index !== 'number') {
    return NextResponse.json({ error: 'template_id and step_index required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const { data: template } = await db
    .from('sequence_templates')
    .select('id, steps')
    .eq('id', body.template_id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!template) {
    return NextResponse.json({ error: 'Template not found in your organisation' }, { status: 404 });
  }

  const steps = (template.steps as Array<Record<string, unknown>>) ?? [];
  const idx = steps.findIndex((s) => s.step_index === body.step_index);
  if (idx === -1) {
    return NextResponse.json({ error: `Step index ${body.step_index} not found in template` }, { status: 404 });
  }

  const updatedStep = { ...steps[idx] };
  if (body.subject !== undefined) updatedStep.subject = body.subject;
  if (body.body !== undefined) updatedStep.body = body.body;
  const newSteps = [...steps];
  newSteps[idx] = updatedStep;

  const { error: updateErr } = await db
    .from('sequence_templates')
    .update({ steps: newSteps })
    .eq('id', body.template_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
