/**
 * One-off: wire the Connexions sprint intake URL onto the "AI tech
 * solutions" product, then bulk-skip every queued/blocked approval row
 * for the operator's org. The current 19-item queue is unshippable (every
 * draft contains a fabricated or placeholder URL because the product had
 * no one_pager_url configured); operator approved clearing it.
 *
 *   node scripts/fix-product-url-and-clear.mjs
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
const INTAKE_URL = 'https://connexions-silk.vercel.app/p/platform-trust-sprint-intake';

// 1. Find the "AI tech solutions" product and wire the intake URL.
const { data: products } = await sb
  .from('products')
  .select('id, name, one_pager_url, pitch_deck_url')
  .eq('organisation_id', ORG_ID);

console.log('Found products:');
for (const p of products ?? []) console.log(' -', p.id, p.name, '| one_pager_url:', p.one_pager_url ?? '(empty)');

const target = (products ?? []).find(p => /AI tech solutions/i.test(p.name ?? ''));
if (!target) {
  console.error('Could not find a product matching /AI tech solutions/i. Aborting URL wire-up.');
  process.exit(1);
}

const { data: updatedProduct, error: updateErr } = await sb
  .from('products')
  .update({ one_pager_url: INTAKE_URL })
  .eq('id', target.id)
  .select('id, name, one_pager_url')
  .single();
if (updateErr) {
  console.error('Failed to update product:', updateErr);
  process.exit(1);
}
console.log('\nProduct updated:', updatedProduct);

// 2. Bulk-skip every queued + compliance_blocked sequence_step. The
// approvals query reads `status IN ('queued_for_approval', 'compliance_blocked')`,
// so flipping every matching row to 'skipped' drains the queue UI-side
// without deleting any data (operator can re-render from /prospects).
const { data: skipped, error: skipErr } = await sb
  .from('sequence_steps')
  .update({ status: 'skipped', updated_at: new Date().toISOString() })
  .eq('organisation_id', ORG_ID)
  .in('status', ['queued_for_approval', 'compliance_blocked'])
  .select('id, status');
if (skipErr) {
  console.error('Failed to bulk-skip:', skipErr);
  process.exit(1);
}
console.log(`\nSkipped ${skipped?.length ?? 0} sequence_steps`);

// 3. Audit log so the action is traceable.
await sb.from('audit_events').insert({
  organisation_id: ORG_ID,
  actor: 'script:fix-product-url-and-clear.mjs',
  action: 'approvals.bulk_skipped',
  resource_type: 'organisation',
  resource_id: ORG_ID,
  payload: {
    cleared: skipped?.length ?? 0,
    reason: 'fabricated URLs in queue — product was missing one_pager_url, fixed via script',
    intake_url_wired: INTAKE_URL,
    product_id: target.id,
  },
});

console.log('\nDone. Next steps:');
console.log('  1. Refresh /settings/products — confirm the intake URL is on the AI tech solutions product.');
console.log('  2. Click "Generate / regenerate sequence" to refresh the template with the URL placeholder.');
console.log('  3. Run discovery from /products → Find Buyers, or re-render existing partners from /prospects.');
