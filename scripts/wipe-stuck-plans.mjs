/**
 * One-off: delete sequence_steps in render_refused / skipped status for
 * the operator's org. Migration 035 introduced render_refused; my
 * earlier reclassify-script moved 96 historic mis-labelled rows into it.
 * The reset endpoint's NON_TERMINAL list wasn't including these
 * statuses, so Restart plan was leaving them attached to partners,
 * which then blocked Plan Outreach from re-planning ("already on a
 * sequence"). The endpoint is now fixed in the same commit but the
 * partners already have stuck rows.
 *
 *   node scripts/wipe-stuck-plans.mjs
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

// Pull the stuck steps first so we can clean up linked outbound_messages.
const { data: stuck } = await sb
  .from('sequence_steps')
  .select('id, outbound_message_id, status, partner_id')
  .eq('organisation_id', ORG_ID)
  .in('status', ['render_refused', 'skipped']);

console.log(`Found ${stuck?.length ?? 0} stuck sequence_steps to wipe.`);

const byStatus = new Map();
for (const s of stuck ?? []) byStatus.set(s.status, (byStatus.get(s.status) || 0) + 1);
for (const [k, v] of byStatus.entries()) console.log(`  ${v}x  ${k}`);

if (!stuck || stuck.length === 0) process.exit(0);

const stepIds = stuck.map(s => s.id);
const msgIds = stuck.map(s => s.outbound_message_id).filter(Boolean);

if (msgIds.length > 0) {
  const { error } = await sb.from('outbound_messages').delete().in('id', msgIds).eq('organisation_id', ORG_ID);
  if (error) console.error('Failed to delete linked outbound_messages:', error.message);
  else console.log(`Deleted ${msgIds.length} linked outbound_messages.`);
}

const { error } = await sb.from('sequence_steps').delete().in('id', stepIds).eq('organisation_id', ORG_ID);
if (error) {
  console.error('Failed to delete steps:', error.message);
  process.exit(1);
}
console.log(`Deleted ${stepIds.length} stuck sequence_steps. Partners are now re-plannable via Plan Outreach.`);
