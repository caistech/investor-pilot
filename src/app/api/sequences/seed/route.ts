/**
 * POST /api/sequences/seed
 * GET  /api/sequences/seed   (alias for one-shot browser use)
 *
 * Idempotent seed: inserts the default v3 senior-debt-lender sequence template
 * for the operator's organisation if it doesn't already exist. Safe to call
 * multiple times.
 *
 * Template design per docs/sprint-0/06+07 v3:
 *   1. LinkedIn connect request (Day 0)
 *   2. LinkedIn DM — first touch after acceptance (Day 2)
 *   3. Email cold touch (Day 3, parallel path if Hunter has email)
 *   4. Email follow-up #1 (Day 7)
 *   5. LinkedIn DM follow-up (Day 9, if no DM reply yet)
 *   6. Email follow-up #2 (Day 14, sequence exit after this)
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

const TEMPLATE_NAME = 'F2K senior debt — direct lender';
const TEMPLATE_VERTICAL = 'senior_debt_au_property';
const COMPLIANCE_MODE = 'finance_au_senior_debt';

const STEPS = [
  {
    step_index: 1,
    channel: 'linkedin_connect',
    delay_days: 0,
    template_key: 'lender_v3_connect',
    description: 'Credit-signal-led connection request (≤300 chars per LinkedIn note limit)',
  },
  {
    step_index: 2,
    channel: 'linkedin_dm',
    delay_days: 2,
    template_key: 'lender_v3_dm_first',
    description: 'First DM after connection accepted; concrete facility specs',
  },
  {
    step_index: 3,
    channel: 'email',
    delay_days: 3,
    template_key: 'lender_v3_email_first',
    description: 'Email first-touch (parallel path if Hunter has work email)',
  },
  {
    step_index: 4,
    channel: 'email',
    delay_days: 7,
    template_key: 'lender_v3_email_fu1',
    description: 'Email follow-up 1 (4 days after first email)',
  },
  {
    step_index: 5,
    channel: 'linkedin_dm',
    delay_days: 9,
    template_key: 'lender_v3_dm_fu',
    description: 'LinkedIn DM follow-up (7 days after first DM)',
  },
  {
    step_index: 6,
    channel: 'email',
    delay_days: 14,
    template_key: 'lender_v3_email_fu2',
    description: 'Email follow-up 2 — final touch, sequence exits after this',
  },
];

export async function POST() {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Idempotency: check whether a template with this exact name already exists
  // for this org. If so, return the existing one without modification.
  const { data: existing } = await db
    .from('sequence_templates')
    .select('id, name, vertical, compliance_mode, is_active, created_at')
    .eq('organisation_id', profile.organisation_id)
    .eq('name', TEMPLATE_NAME)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      action: 'already_exists',
      template: existing,
      message: 'Template already seeded for this organisation. No changes made.',
    });
  }

  const { data: inserted, error: insertError } = await db
    .from('sequence_templates')
    .insert({
      organisation_id: profile.organisation_id,
      name: TEMPLATE_NAME,
      vertical: TEMPLATE_VERTICAL,
      description:
        'Direct-to-lender outreach sequence for F2K\'s $18.7M senior debt syndicate. Per Senior Debt Brief v3.',
      steps: STEPS,
      compliance_mode: COMPLIANCE_MODE,
      is_active: true,
    })
    .select('id, name, vertical, compliance_mode, is_active, created_at')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await db.from('audit_events').insert({
    organisation_id: profile.organisation_id,
    actor: `user:${user!.id}`,
    action: 'sequence_template.seeded',
    resource_type: 'sequence_template',
    resource_id: inserted.id,
    payload: { name: TEMPLATE_NAME, vertical: TEMPLATE_VERTICAL, step_count: STEPS.length },
  });

  return NextResponse.json({
    ok: true,
    action: 'inserted',
    template: inserted,
    step_count: STEPS.length,
  });
}

export async function GET() {
  return POST();
}
