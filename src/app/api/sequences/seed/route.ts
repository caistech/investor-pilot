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
import { SEED_TEMPLATES } from '@/lib/sequencer/seed-templates';

/**
 * Enrich a step with the seed template content (subject, body, max_chars,
 * is_warm) drawn from SEED_TEMPLATES by template_key. Phase D — the cron
 * + admin renderers now read content directly from the step's JSONB; new
 * tenants seeded via this route get full content embedded so they don't
 * rely on the fallback.
 */
function withSeedContent<T extends { template_key: string }>(step: T): T & {
  subject: string | null;
  body: string;
  max_chars: number;
  is_warm: boolean;
} {
  const seed = SEED_TEMPLATES[step.template_key];
  return {
    ...step,
    subject: seed?.subject ?? null,
    body: seed?.body ?? '',
    max_chars: seed?.max_chars ?? 2000,
    is_warm: seed?.is_warm ?? false,
  };
}

const TEMPLATE_NAME = 'F2K senior debt — direct lender';
const TEMPLATE_VERTICAL = 'senior_debt_au_property';
const COMPLIANCE_MODE = 'finance_au_senior_debt';

const WARM_TEMPLATE_NAME = 'F2K senior debt — warm DM (1st-degree)';

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

// Warm DM 3-step sequence for 1st-degree LinkedIn connections.
// No connect step (operator and recipient already connected). Tighter cadence
// because warm relationships tolerate faster follow-up.
const WARM_STEPS = [
  {
    step_index: 1,
    channel: 'linkedin_dm',
    delay_days: 0,
    template_key: 'lender_v3_warm_dm_first',
    description: 'Warm DM Day 0 — relationship-led, full facility specifics inline',
  },
  {
    step_index: 2,
    channel: 'linkedin_dm',
    delay_days: 4,
    template_key: 'lender_v3_warm_dm_fu',
    description: 'Warm DM follow-up Day 4 — short nudge',
  },
  {
    step_index: 3,
    channel: 'linkedin_dm',
    delay_days: 9,
    template_key: 'lender_v3_warm_dm_final',
    description: 'Warm DM final Day 9 — closing the loop, door open',
  },
];

export async function POST() {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }
  const organisation_id: string = profile.active_organisation_id;

  const cold = await ensureTemplate(db, organisation_id, user!.id, {
    name: TEMPLATE_NAME,
    description: "Direct-to-lender outreach sequence for F2K's $18.7M senior debt syndicate. Per Senior Debt Brief v3.",
    steps: STEPS.map(withSeedContent),
  });

  const warm = await ensureTemplate(db, organisation_id, user!.id, {
    name: WARM_TEMPLATE_NAME,
    description:
      "Warm DM-only sequence for operator's 1st-degree LinkedIn connections. 3 steps over 9 days. No connect-request step — recipient already accepted.",
    steps: WARM_STEPS.map(withSeedContent),
  });

  return NextResponse.json({
    ok: true,
    cold,
    warm,
  });
}

async function ensureTemplate(
  db: Awaited<ReturnType<typeof authenticateAndGetDb>>['db'],
  organisation_id: string,
  user_id: string,
  tpl: { name: string; description: string; steps: ReturnType<typeof withSeedContent>[] },
) {
  // Idempotency: check whether a template with this exact name already exists
  // for this org. If so, return it without modification.
  const { data: existing } = await db!
    .from('sequence_templates')
    .select('id, name, vertical, compliance_mode, is_active, created_at')
    .eq('organisation_id', organisation_id)
    .eq('name', tpl.name)
    .maybeSingle();

  if (existing) {
    return {
      action: 'already_exists' as const,
      template: existing,
      step_count: tpl.steps.length,
    };
  }

  const { data: inserted, error: insertError } = await db!
    .from('sequence_templates')
    .insert({
      organisation_id,
      name: tpl.name,
      vertical: TEMPLATE_VERTICAL,
      description: tpl.description,
      steps: tpl.steps,
      compliance_mode: COMPLIANCE_MODE,
      is_active: true,
    })
    .select('id, name, vertical, compliance_mode, is_active, created_at')
    .single();

  if (insertError) {
    return { action: 'error' as const, error: insertError.message, step_count: tpl.steps.length };
  }

  await db!.from('audit_events').insert({
    organisation_id,
    actor: `user:${user_id}`,
    action: 'sequence_template.seeded',
    resource_type: 'sequence_template',
    resource_id: inserted.id,
    payload: { name: tpl.name, vertical: TEMPLATE_VERTICAL, step_count: tpl.steps.length },
  });

  return {
    action: 'inserted' as const,
    template: inserted,
    step_count: tpl.steps.length,
  };
}

export async function GET() {
  return POST();
}
