/**
 * One-off: reclassify historic sequence_steps that landed in
 * 'compliance_blocked' but were actually render refusals
 * (renderer.ok === false, never produced an outbound_message). Migration
 * 035 added the 'render_refused' status; this script applies it to the
 * audit-events-attested rows so the operator-facing report no longer
 * conflates "OpenRouter out of credits" with "compliance regex hit".
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

// Steps marked compliance_blocked with NO outbound_message_id are render
// refusals (the runner.ts:305 path never inserts a message). Steps marked
// compliance_blocked WITH an outbound_message_id are real compliance hits
// (the runner.ts:324 path writes the message then sets status).
const { data: candidates } = await sb
  .from('sequence_steps')
  .select('id, outbound_message_id')
  .eq('organisation_id', ORG_ID)
  .eq('status', 'compliance_blocked')
  .is('outbound_message_id', null);

console.log(`Found ${candidates?.length ?? 0} compliance_blocked steps with no outbound_message_id (= render refusals misclassified).`);

if (!candidates || candidates.length === 0) {
  console.log('Nothing to reclassify.');
  process.exit(0);
}

const ids = candidates.map(c => c.id);
const { error } = await sb
  .from('sequence_steps')
  .update({ status: 'render_refused', updated_at: new Date().toISOString() })
  .in('id', ids);
if (error) {
  console.error('UPDATE failed:', error.message);
  process.exit(1);
}
console.log(`Reclassified ${ids.length} steps → render_refused.`);
