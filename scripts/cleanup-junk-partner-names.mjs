/**
 * One-off: re-normalise existing partners.company_name through the new
 * cleanCompanyName logic. Brave-sourced partners discovered before
 * commit shipping the discovery-side normaliser carry page-title-shaped
 * company_names ("Renovation Builders Sydney|Civil...", "Company
 * History", "About Us — X"). The render-side garbage detector will now
 * refuse to render them; this script fixes the underlying rows so
 * rerender produces clean drafts.
 *
 *   node scripts/cleanup-junk-partner-names.mjs
 *
 * Re-runnable. Reports what would change first; pass --apply to write.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const APPLY = process.argv.includes('--apply');

// Mirror of the regexes in src/lib/discovery/clean-company-name.ts.
// Kept inline so the script doesn't need a build step.
const JUNK_NAME_PATTERNS = [
  /^(company\s*history|about\s*(us)?|contact(\s*us)?|home(\s*page)?|services?|products?|portfolio|team|news|blog|case\s*stud(ies|y))$/i,
  /^[^|]+\|[^|]+\|[^|]+/,
  /journey of|story of|history of|guide to|introduction to/i,
  /^(.+'?s\s+)?(top|largest|best|biggest|leading)\s+\d*/i,
  /^(your|the)\s+\w+\s+(experts?|solutions?|specialists?|leaders?)\s*$/i,
  /^family[\s-]?owned\s+\w+(\s+\w+){0,5}\s+company$/i,
  /\b(powers|wins|celebrates|launches|expands|announces|acquires|partners with|secures|reveals)\s+\w/i,
];
const SUFFIX_SEPARATORS = /\s+[\-:|·•]\s*|\s*[\-:|·•]\s+|\s+I\s+/;

function cleanCompanyName(raw) {
  const original = (raw ?? '').toString();
  if (!original.trim()) return { cleaned: null, still_junk: true };
  let work = original.trim().replace(/\s+/g, ' ').replace(/[‘’“”]/g, "'");
  if (work.includes('|')) {
    const segs = work.split('|').map(s => s.trim()).filter(Boolean);
    if (segs.length) work = segs[0];
  }
  const m = work.match(SUFFIX_SEPARATORS);
  if (m && m.index !== undefined && m.index >= 2) {
    const left = work.slice(0, m.index).trim();
    if (/[A-Za-z]/.test(left) && left.length >= 2 && !JUNK_NAME_PATTERNS.some(p => p.test(left))) {
      work = left;
    }
  }
  work = work.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return {
    cleaned: work || null,
    still_junk: JUNK_NAME_PATTERNS.some(p => p.test(work)) || work.length < 2,
  };
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

const { data: partners } = await sb
  .from('partners')
  .select('id, company_name, source')
  .eq('organisation_id', ORG_ID);

let changeCount = 0;
let refuseCount = 0;
const changes = [];

for (const p of partners ?? []) {
  const result = cleanCompanyName(p.company_name);
  if (!result.cleaned) {
    console.log(`[REFUSE] ${p.id} — "${p.company_name}" → null. Operator must fix manually.`);
    refuseCount++;
    continue;
  }
  if (result.still_junk) {
    console.log(`[STILL JUNK] ${p.id} — "${p.company_name}" → "${result.cleaned}" (still flagged). Render will refuse.`);
    refuseCount++;
    continue;
  }
  if (result.cleaned !== p.company_name) {
    console.log(`[CLEAN]  ${p.id} — "${p.company_name}" → "${result.cleaned}"`);
    changes.push({ id: p.id, from: p.company_name, to: result.cleaned });
    changeCount++;
  }
}

console.log(`\nSummary: ${changes.length} would change, ${refuseCount} still junk after cleanup (operator must edit), ${(partners?.length ?? 0) - changeCount - refuseCount} already clean.`);

if (!APPLY) {
  console.log('\nDry run. Pass --apply to write.');
  process.exit(0);
}

for (const c of changes) {
  const { error } = await sb
    .from('partners')
    .update({ company_name: c.to })
    .eq('id', c.id);
  if (error) {
    console.error(`  UPDATE ${c.id} failed:`, error.message);
  }
}
console.log(`\nApplied ${changes.length} company_name normalisations.`);
