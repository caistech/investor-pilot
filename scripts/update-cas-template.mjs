// One-off: rewrite the CAS AI Build sequence template (id 10125fd5-73e1-...)
// to conform to docs/messaging-framework.md. All 6 steps are Tier 1
// (1st-degree warm) since every current prospect is a connected operator.
//
// Reads .env.local manually so this can run from a plain `node scripts/...`.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TEMPLATE_ID = '10125fd5-73e1-4ac4-ab94-d56c10f994a6';
const INTAKE_URL = 'https://connexions-silk.vercel.app/p/platform-trust-sprint-intake';

const steps = [
  {
    step_index: 1,
    channel: 'linkedin_connect',
    is_warm: true,
    subject: null,
    max_chars: 300,
    delay_days: 0,
    template_key: 'auto_connect',
    description: 'LinkedIn connect / warm DM opener — Tier 1, ≤300 chars, friendly + soft intake ask',
    body: `Hi {first_name} — good to be connected. We build fixed-price AI tools for operator-led businesses (no in-house devs). If one slow workflow comes to mind, this 7-min interviewer captures it: ${INTAKE_URL} — {sender_name}`,
  },
  {
    step_index: 2,
    channel: 'linkedin_dm',
    is_warm: true,
    subject: null,
    max_chars: 1200,
    delay_days: 2,
    template_key: 'auto_dm_first',
    description: 'First DM after connect — Tier 1 friendly, value-first, workflow-problem ask, intake link inline',
    body: `Hi {first_name} — quick one, know your day's full.

{credit_signal_lead}

We build fixed-price AI tools for operator-led businesses without in-house dev teams — most have one process that's quietly costing more than it should. Recently delivered MMC Build (multi-tenant platform for Australian modular construction): stages 0–5 in 5 weeks against a 14-week schedule, fixed price.

If a slow or costly workflow at {firm} comes to mind, this 7-min AI interviewer captures it — no call, no pressure: ${INTAKE_URL}

— {sender_name}`,
  },
  {
    step_index: 3,
    channel: 'email',
    is_warm: true,
    subject: '{first_name} — one slow workflow worth a look?',
    max_chars: 1500,
    delay_days: 3,
    template_key: 'auto_email_first',
    description: 'Email first-touch — Tier 1 friendly, value-first, workflow-problem ask, intake link only CTA',
    body: `Hi {first_name},

Short note — know your inbox is heavy.

{credit_signal_lead}

We build fixed-price AI tools for operator-led businesses in construction, trades, manufacturing, logistics, and property — no in-house developers needed. 35+ live builds. Recently delivered MMC Build (multi-tenant platform for Australian modular construction) in 5 weeks against a 14-week schedule, fixed price.

If a slow or costly workflow at {firm} comes to mind, this 7-min AI interviewer captures it — no call, I review every intake personally within 48 hours: ${INTAKE_URL}

— {sender_name}
{sender_role}`,
  },
  {
    step_index: 4,
    channel: 'email',
    is_warm: true,
    subject: '{first_name} — quick follow-up',
    max_chars: 900,
    delay_days: 7,
    template_key: 'auto_email_fu1',
    description: 'Email follow-up 1 — short, problem-framed, intake link as lead CTA',
    body: `{first_name} — quick follow-up, no reply needed if timing's off.

{credit_signal_lead_short}

If a workflow at {firm} is slower or costlier than it should be, the easiest no-pressure next step is our 7-min AI interviewer (1-min form first, I review within 48 hours): ${INTAKE_URL}

— {sender_name}`,
  },
  {
    step_index: 5,
    channel: 'linkedin_dm',
    is_warm: true,
    subject: null,
    max_chars: 600,
    delay_days: 9,
    template_key: 'auto_dm_fu',
    description: 'DM follow-up — last LinkedIn touch before closing the loop',
    body: `{first_name} — circling back briefly.

Quickest no-pressure way to find out if there's a fit: 7-min AI interviewer, no call, I review within 48 hours: ${INTAKE_URL}

Otherwise I'll close the loop after this.

— {sender_name}`,
  },
  {
    step_index: 6,
    channel: 'email',
    is_warm: true,
    subject: 'Closing the loop',
    max_chars: 700,
    delay_days: 14,
    template_key: 'auto_email_fu2',
    description: 'Closing-loop email — graceful exit, persistent intake link',
    body: `{first_name},

Closing the loop — I won't follow up again on this one.

If a fixed-price AI build for {firm} ever becomes relevant — a workflow that's slow or costly with no technical team to fix it — the intake stays open whenever you want: ${INTAKE_URL}

Door's open either way.

— {sender_name}
{sender_role}`,
  },
];

const { data, error } = await sb
  .from('sequence_templates')
  .update({ steps, updated_at: new Date().toISOString() })
  .eq('id', TEMPLATE_ID)
  .select('id,name,updated_at')
  .maybeSingle();

if (error) {
  console.error('update failed:', error);
  process.exit(1);
}

console.log('updated template:', JSON.stringify(data, null, 2));
console.log(`\n${steps.length} steps rewritten per messaging-framework.md.`);
