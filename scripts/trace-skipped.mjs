// Diagnose where the 358 skipped sequence_steps came from.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

const r = await sb
  .from('audit_events')
  .select('action, actor, created_at, payload')
  .eq('organisation_id', ORG_ID)
  .in('action', ['approvals.bulk_skipped', 'approval.skipped', 'sequences.reset'])
  .order('created_at', { ascending: false })
  .limit(20);

console.log('Recent skip-related audit events:');
for (const e of r.data || []) {
  const idsCount = e.payload?.ids?.length ?? 0;
  const clearedCount = e.payload?.cleared ?? 0;
  console.log('  ', e.created_at, '|', e.action, '| actor:', e.actor, '| ids:', idsCount, '| cleared:', clearedCount);
}

// Also: bucket the 358 skipped by updated_at to see if they all moved at once
const s = await sb
  .from('sequence_steps')
  .select('updated_at')
  .eq('organisation_id', ORG_ID)
  .eq('status', 'skipped')
  .order('updated_at', { ascending: false });

const byHour = new Map();
for (const row of s.data || []) {
  const hour = (row.updated_at || '').slice(0, 13); // YYYY-MM-DDTHH
  byHour.set(hour, (byHour.get(hour) || 0) + 1);
}
console.log('\nSkipped rows by updated_at hour:');
for (const [h, n] of [...byHour.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
  console.log('  ', h, ':', n);
}
