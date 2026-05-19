/**
 * One-off: bump the founder org's usage caps so dogfooding doesn't hit
 * trial-tier walls. Run from project root:
 *   node scripts/bump-usage-caps.mjs
 *
 * Reads .env.local for the Supabase URL + service role key. Updates the
 * organisation_usage_caps row for the CAS org id. Safe to re-run — UPDATE
 * is idempotent.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

const { data: before } = await sb
  .from('organisation_usage_caps')
  .select('*')
  .eq('organisation_id', ORG_ID)
  .single();

console.log('BEFORE:', JSON.stringify(before, null, 2));

const { data: after, error } = await sb
  .from('organisation_usage_caps')
  .update({
    plan_tier: 'unlimited',
    hard_block: false,
    cap_llm_tokens_per_month: 100_000_000,
    cap_brave_queries_per_month: 100_000,
    cap_hunter_lookups_per_month: 100_000,
    cap_unipile_accounts: 20,
    notes: 'Founder dogfooding — caps informational only (bumped 2026-05-19)',
    updated_at: new Date().toISOString(),
  })
  .eq('organisation_id', ORG_ID)
  .select()
  .single();

if (error) {
  console.error('UPDATE failed:', error);
  process.exit(1);
}

console.log('\nAFTER:', JSON.stringify(after, null, 2));
console.log('\nDone. Refresh /settings/products and click Generate ICP scoring rubric.');
