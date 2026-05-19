/**
 * One-off: delete PENDING (non-terminal) linkedin_connect / linkedin_dm
 * steps for Brave-sourced partners. Operator decision 2026-05-19:
 * Brave-sourced rows go email-only because Hunter's guessed LinkedIn
 * URLs are unreliable (may resolve to the wrong person, defunct
 * profile, or no account).
 *
 * Preserves:
 *   - Already-sent LinkedIn steps (sent / replied / opted_out are terminal,
 *     not touched)
 *   - All email steps (still firing)
 *   - LinkedIn-sourced partners (source='linkedin' or 'sales_nav')
 *
 *   node scripts/strip-linkedin-from-brave.mjs
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

// Includes failed + render_refused so we sweep dead LinkedIn attempts
// that already burned through (Hunter URL didn't resolve, etc). 'sent',
// 'replied', 'opted_out' stay — those reflect real history.
const STRIPPABLE_STATUSES = [
  'pending', 'queued_for_approval', 'awaiting_verification',
  'failed', 'render_refused', 'compliance_blocked', 'skipped',
];
const LINKEDIN_CHANNELS = ['linkedin_connect', 'linkedin_dm'];

const { data: bravePartners, error: pErr } = await sb
  .from('partners')
  .select('id, company_name')
  .eq('organisation_id', ORG_ID)
  .eq('source', 'brave');

if (pErr) {
  console.error('Failed to fetch Brave partners:', pErr.message);
  process.exit(1);
}
console.log(`Scanning ${bravePartners?.length ?? 0} Brave-sourced partners…`);

if (!bravePartners || bravePartners.length === 0) {
  console.log('No Brave partners. Done.');
  process.exit(0);
}

const partnerIds = bravePartners.map(p => p.id);

const { data: pendingLi, error: sErr } = await sb
  .from('sequence_steps')
  .select('id, partner_id, channel, status, outbound_message_id')
  .eq('organisation_id', ORG_ID)
  .in('partner_id', partnerIds)
  .in('status', STRIPPABLE_STATUSES)
  .in('channel', LINKEDIN_CHANNELS);

if (sErr) {
  console.error('Failed to fetch pending LinkedIn steps:', sErr.message);
  process.exit(1);
}

console.log(`Found ${pendingLi?.length ?? 0} pending LinkedIn steps on Brave-sourced partners.`);

if (!pendingLi || pendingLi.length === 0) {
  console.log('Nothing to strip. Done.');
  process.exit(0);
}

const byChannel = new Map();
const byStatus = new Map();
for (const s of pendingLi) {
  byChannel.set(s.channel, (byChannel.get(s.channel) || 0) + 1);
  byStatus.set(s.status, (byStatus.get(s.status) || 0) + 1);
}
for (const [k, v] of byChannel.entries()) console.log(`  channel=${k}: ${v}`);
for (const [k, v] of byStatus.entries()) console.log(`  status=${k}: ${v}`);

const stepIds = pendingLi.map(s => s.id);
const msgIds = pendingLi.map(s => s.outbound_message_id).filter(Boolean);

if (msgIds.length > 0) {
  const { error } = await sb
    .from('outbound_messages')
    .delete()
    .in('id', msgIds)
    .eq('organisation_id', ORG_ID);
  if (error) console.error('Failed to delete linked outbound_messages:', error.message);
  else console.log(`Deleted ${msgIds.length} linked outbound_messages.`);
}

const { error: dErr } = await sb
  .from('sequence_steps')
  .delete()
  .in('id', stepIds)
  .eq('organisation_id', ORG_ID);
if (dErr) {
  console.error('Failed to delete sequence_steps:', dErr.message);
  process.exit(1);
}
console.log(`Deleted ${stepIds.length} pending LinkedIn steps on Brave partners. Email steps remain.`);
