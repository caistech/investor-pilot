import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

const { data: recent } = await sb
  .from('sequence_steps')
  .select('id, status, channel, partner_id, template_id, updated_at, outbound_message_id')
  .eq('organisation_id', ORG_ID)
  .order('updated_at', { ascending: false })
  .limit(200);

const byStatus = new Map();
for (const s of recent ?? []) byStatus.set(s.status, (byStatus.get(s.status) || 0) + 1);
console.log('Status distribution:');
for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x  ${k}`);

const blocked = (recent ?? []).filter(s => s.status === 'compliance_blocked');
console.log(`\nSample 5 compliance_blocked steps:`);
for (const s of blocked.slice(0, 5)) {
  console.log(`  ${s.id} channel=${s.channel} omid=${s.outbound_message_id}`);
}

// Approach: look up outbound_messages by partner_id (not by outbound_message_id
// because those are null on the steps for some reason).
const partnerIds = [...new Set(blocked.map(s => s.partner_id).filter(Boolean))].slice(0, 15);
console.log(`\nLooking up outbound_messages for ${partnerIds.length} partners...`);
const { data: msgs, error: msgErr } = await sb
  .from('outbound_messages')
  .select('id, partner_id, channel, rendered_subject, rendered_body, compliance_check, created_at')
  .in('partner_id', partnerIds)
  .order('created_at', { ascending: false });

if (msgErr) {
  console.error('Query error:', msgErr);
  process.exit(1);
}

console.log(`Got ${msgs?.length ?? 0} messages.`);
const flagCounts = new Map();
const samples = [];
for (const m of msgs ?? []) {
  const flags = m.compliance_check?.flags || [];
  for (const f of flags) flagCounts.set(f.reason, (flagCounts.get(f.reason) || 0) + 1);
  if (m.compliance_check?.blocked && samples.length < 4) samples.push(m);
}

console.log('\n--- TOP FLAG REASONS ---');
for (const [reason, count] of [...flagCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x  ${reason}`);
}

console.log('\n--- SAMPLE BLOCKED DRAFTS ---');
for (const m of samples) {
  console.log(`\nMessage ${m.id} channel=${m.channel}:`);
  console.log(`  Flags: ${JSON.stringify(m.compliance_check.flags)}`);
  console.log(`  Body: ${(m.rendered_body || '').replace(/\n/g, ' | ').slice(0, 600)}`);
}
