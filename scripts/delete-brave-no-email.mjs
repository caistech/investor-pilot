/**
 * One-off: sweep existing Brave-sourced partners that lack a
 * contact_email. New rule per operator 2026-05-19: "For Brave non-LI
 * contacts we need company + name + email. If we haven't got all
 * three, delete." Discovery now enforces this at score time, but the
 * partners table already has rows from before — clean those up too.
 *
 * Preserves: LinkedIn-sourced rows regardless of email (their LI URL
 * is the reachability proof). Sent / replied / opted_out rows are
 * historical and untouched even if Brave + no email — bulk-delete
 * cascades sequence_steps so we don't want to nuke real history.
 *
 *   node scripts/delete-brave-no-email.mjs
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

// Statuses we WON'T touch — these reflect real outreach history.
const PROTECTED_STATUSES = new Set([
  'sent', 'replied', 'opted_out', 'follow_up_due', 'meeting_booked',
  'closed_won', 'closed_lost', 'engaged',
]);

const { data: braveRows } = await sb
  .from('partners')
  .select('id, company_name, contact_name, contact_email, status')
  .eq('organisation_id', ORG_ID)
  .eq('source', 'brave');

console.log(`Total Brave-sourced partners: ${braveRows?.length ?? 0}`);

if (!braveRows || braveRows.length === 0) {
  console.log('Nothing to sweep.');
  process.exit(0);
}

const toDelete = braveRows.filter(p => {
  const hasEmail = typeof p.contact_email === 'string' && p.contact_email.trim().length > 0;
  const hasName = typeof p.contact_name === 'string' && p.contact_name.trim().length > 0;
  if (hasEmail && hasName) return false;
  if (PROTECTED_STATUSES.has(p.status)) return false;
  return true;
});

console.log(`Brave partners missing email or name AND not in protected status: ${toDelete.length}`);
for (const p of toDelete.slice(0, 20)) {
  const missing = [];
  if (!p.contact_name || !p.contact_name.trim()) missing.push('no name');
  if (!p.contact_email || !p.contact_email.trim()) missing.push('no email');
  console.log(`  ${p.company_name} (${missing.join(' + ')}) status=${p.status}`);
}
if (toDelete.length > 20) console.log(`  ...and ${toDelete.length - 20} more`);

if (toDelete.length === 0) {
  console.log('Nothing to delete.');
  process.exit(0);
}

const ids = toDelete.map(p => p.id);

// Clear linked sequence_steps + outbound_messages first (most Brave-no-email
// rows shouldn't have any, but be defensive).
const { data: linkedSteps } = await sb
  .from('sequence_steps')
  .select('id, outbound_message_id')
  .in('partner_id', ids)
  .eq('organisation_id', ORG_ID);

if (linkedSteps && linkedSteps.length > 0) {
  const msgIds = linkedSteps.map(s => s.outbound_message_id).filter(Boolean);
  if (msgIds.length > 0) {
    await sb.from('outbound_messages').delete().in('id', msgIds).eq('organisation_id', ORG_ID);
    console.log(`Cleared ${msgIds.length} linked outbound_messages.`);
  }
  await sb.from('sequence_steps').delete().in('id', linkedSteps.map(s => s.id)).eq('organisation_id', ORG_ID);
  console.log(`Cleared ${linkedSteps.length} linked sequence_steps.`);
}

const { error } = await sb
  .from('partners')
  .delete()
  .in('id', ids)
  .eq('organisation_id', ORG_ID);

if (error) {
  console.error('FAILED:', error.message);
  process.exit(1);
}

console.log(`Deleted ${ids.length} Brave partners with no email.`);
console.log('Prospects table now contains only: LinkedIn rows with LI URLs, or Brave rows with company+name+email.');
