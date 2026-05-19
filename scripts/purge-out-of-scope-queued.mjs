/**
 * One-off: delete in-flight sequence_steps (pending / queued_for_approval)
 * for partners the LLM scorer marked out_of_scope. Operator flagged
 * 2026-05-19 that the approval queue had filled with pseudo-specific
 * copy to article authors and category-mismatch contacts. The
 * assign-batch route now hard-refuses out_of_scope rows at plan time,
 * but the partners already on a plan need a one-off cleanup.
 *
 *   node scripts/purge-out-of-scope-queued.mjs
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

const IN_FLIGHT_STATUSES = ['pending', 'queued_for_approval', 'awaiting_verification'];

const { data: oosPartners, error: pErr } = await sb
  .from('partners')
  .select('id, company_name, category')
  .eq('organisation_id', ORG_ID)
  .ilike('category', '%out_of_scope%');

if (pErr) {
  console.error('Failed to fetch out_of_scope partners:', pErr.message);
  process.exit(1);
}
console.log(`Found ${oosPartners?.length ?? 0} partners marked out_of_scope in org.`);

if (!oosPartners || oosPartners.length === 0) process.exit(0);

const partnerIds = oosPartners.map(p => p.id);

const { data: stuck, error: sErr } = await sb
  .from('sequence_steps')
  .select('id, partner_id, outbound_message_id, status, channel')
  .eq('organisation_id', ORG_ID)
  .in('partner_id', partnerIds)
  .in('status', IN_FLIGHT_STATUSES);

if (sErr) {
  console.error('Failed to fetch sequence_steps:', sErr.message);
  process.exit(1);
}

console.log(`Found ${stuck?.length ?? 0} in-flight sequence_steps on out_of_scope partners.`);

const byStatus = new Map();
const byChannel = new Map();
for (const s of stuck ?? []) {
  byStatus.set(s.status, (byStatus.get(s.status) || 0) + 1);
  byChannel.set(s.channel, (byChannel.get(s.channel) || 0) + 1);
}
for (const [k, v] of byStatus.entries()) console.log(`  status=${k}: ${v}`);
for (const [k, v] of byChannel.entries()) console.log(`  channel=${k}: ${v}`);

if (stuck && stuck.length > 0) {
  const stepIds = stuck.map(s => s.id);
  const msgIds = stuck.map(s => s.outbound_message_id).filter(Boolean);

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
  console.log(`Deleted ${stepIds.length} in-flight sequence_steps on out_of_scope partners.`);
} else {
  console.log('No in-flight sequence_steps to delete (already clean).');
}

// Reset stale partner.status badges. After deleting the underlying
// sequence_steps, partners that wore 'draft_ready' / 'drafted' /
// 'queued_for_approval' on their `status` column are now badge-only
// stale state — there's no draft behind them. Reset to 'contact_found'
// (the pre-drafted state) so the Prospects list reflects reality.
// 'sent' / 'replied' / 'follow_up_due' etc are NOT touched — those
// reflect real historical events and stay.
const STALE_STATUSES = ['draft_ready', 'drafted', 'queued_for_approval', 'queued', 'awaiting_verification'];
const { data: stalePartners, error: spErr } = await sb
  .from('partners')
  .select('id, status')
  .in('id', partnerIds)
  .in('status', STALE_STATUSES);
if (spErr) {
  console.error('Failed to fetch stale partner statuses:', spErr.message);
  process.exit(1);
}
console.log(`Resetting ${stalePartners?.length ?? 0} stale partner.status badges → 'contact_found'.`);
if (stalePartners && stalePartners.length > 0) {
  const { error: upErr } = await sb
    .from('partners')
    .update({ status: 'contact_found' })
    .in('id', stalePartners.map(p => p.id))
    .eq('organisation_id', ORG_ID);
  if (upErr) {
    console.error('Failed to reset partner.status:', upErr.message);
    process.exit(1);
  }
  console.log('Done. Prospects list will now reflect actual state.');
}
console.log('Approval queue is clean.');
