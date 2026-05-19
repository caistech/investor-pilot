import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

const { data: events } = await sb
  .from('audit_events')
  .select('id, action, payload, created_at')
  .eq('organisation_id', ORG_ID)
  .eq('action', 'sequence.render_blocked')
  .order('created_at', { ascending: false })
  .limit(200);

console.log(`Found ${events?.length ?? 0} render_blocked audit events. Top reasons:`);

const blockerCounts = new Map();
const sampleByBlocker = new Map();
for (const e of events ?? []) {
  const blocker = e.payload?.blocker || 'unknown';
  const reason = e.payload?.reason || '(no reason recorded)';
  blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
  if (!sampleByBlocker.has(blocker)) sampleByBlocker.set(blocker, reason);
}
for (const [b, c] of [...blockerCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c}x  ${b}`);
  console.log(`        sample: ${(sampleByBlocker.get(b) || '').slice(0, 200)}`);
}
