/**
 * POST /api/approvals/[id]/edit
 *
 * Lets the operator tweak a rendered message before approving it. Updates
 * outbound_messages.rendered_subject and rendered_body for the queued
 * step. No state transition — the step stays queued_for_approval, the
 * operator still has to click Approve & send to dispatch it.
 *
 * Body:
 *   { rendered_subject?: string | null, rendered_body: string }
 *
 * Common use cases:
 *   - Soften / personalise the auto-generated warm opener
 *   - Adjust a specific number, fact, or phrasing per compliance review
 *   - Add a recipient-specific reference the renderer didn't have data for
 *
 * Audit-logs every edit with both the old and new bodies so we have a
 * full chain back to whatever Claude originally produced.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { checkCompliance } from '@/lib/compliance/filter';

const MAX_BODY_LENGTH = 8000; // LinkedIn DM hard cap is 8k; emails much higher

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const newSubject = typeof body.rendered_subject === 'string'
    ? body.rendered_subject
    : body.rendered_subject === null
    ? null
    : undefined;
  const newBody = typeof body.rendered_body === 'string' ? body.rendered_body : undefined;

  if (typeof newBody !== 'string' || newBody.trim().length === 0) {
    return NextResponse.json({ error: 'rendered_body required (non-empty string)' }, { status: 400 });
  }
  if (newBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `rendered_body exceeds ${MAX_BODY_LENGTH} chars` },
      { status: 400 },
    );
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: step } = await db
    .from('sequence_steps')
    .select('id, status, outbound_message_id, partner_id, template_id')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  // Allow editing on compliance_blocked too — that's the natural fix
  // path when a draft trips a regex. Edit re-runs compliance check
  // and (if clean) transitions the step back to queued_for_approval.
  if (step.status !== 'queued_for_approval' && step.status !== 'compliance_blocked') {
    return NextResponse.json(
      { error: `Step is ${step.status}; only queued_for_approval or compliance_blocked messages can be edited` },
      { status: 400 },
    );
  }
  if (!step.outbound_message_id) {
    return NextResponse.json({ error: 'Step has no outbound message to edit' }, { status: 400 });
  }

  const { data: msg } = await db
    .from('outbound_messages')
    .select('id, rendered_subject, rendered_body, compliance_check')
    .eq('id', step.outbound_message_id)
    .single();

  if (!msg) return NextResponse.json({ error: 'Outbound message missing' }, { status: 500 });

  // Look up the template compliance_mode so the re-check uses the same
  // ruleset as the original render. Falls back to a permissive default
  // if template_id is null (shouldn't happen but defensive).
  const { data: template } = await db
    .from('sequence_templates')
    .select('compliance_mode')
    .eq('id', step.template_id)
    .single();

  const complianceMode = (template?.compliance_mode as
    | 'finance_au_senior_debt'
    | 'standard'
    | undefined) || 'standard';

  // Re-run compliance on the edited body so a freshly-typed dollar figure
  // or claim gets caught BEFORE the operator clicks Approve. Subject is
  // included where present (matters for emails).
  const checkText = [newSubject ?? msg.rendered_subject, newBody].filter(Boolean).join('\n');
  const complianceResult = checkCompliance(checkText, complianceMode);

  const finalSubject = newSubject !== undefined ? newSubject : msg.rendered_subject;

  const { error: updateError } = await db
    .from('outbound_messages')
    .update({
      rendered_subject: finalSubject,
      rendered_body: newBody,
      compliance_check: complianceResult,
    })
    .eq('id', msg.id);

  if (updateError) {
    return NextResponse.json({ error: `Update failed: ${updateError.message}` }, { status: 500 });
  }

  // Status transition: a compliance_blocked step that now passes
  // compliance flips back to queued_for_approval so the operator can
  // Approve & send. Conversely, an edit to a queued draft that NOW
  // trips a flag flips to compliance_blocked. Without these flips, a
  // fixed draft stays blocked forever and a newly-broken draft would
  // silently ship.
  const newStepStatus = complianceResult.blocked ? 'compliance_blocked' : 'queued_for_approval';
  if (newStepStatus !== step.status) {
    const { error: stepUpdateError } = await db
      .from('sequence_steps')
      .update({ status: newStepStatus })
      .eq('id', step.id);
    if (stepUpdateError) {
      return NextResponse.json(
        { error: `Compliance updated but step status transition failed: ${stepUpdateError.message}` },
        { status: 500 },
      );
    }
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'approval.edited',
    resource_type: 'outbound_message',
    resource_id: msg.id,
    payload: {
      step_id: step.id,
      partner_id: step.partner_id,
      previous_subject: msg.rendered_subject,
      previous_body: msg.rendered_body,
      new_subject: finalSubject,
      new_body: newBody,
      compliance_flags_after_edit: complianceResult.flags,
    },
  });

  return NextResponse.json({
    ok: true,
    message_id: msg.id,
    rendered_subject: finalSubject,
    rendered_body: newBody,
    compliance_check: complianceResult,
  });
}
