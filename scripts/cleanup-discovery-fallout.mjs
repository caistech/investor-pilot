/**
 * One-off cleanup after the discovery hardening on 2026-05-19:
 *   1. DELETE all out_of_scope partners (and any linked rows). The new
 *      discover route drops these at score-time, but the 89 existing
 *      ones still clutter the Prospects table.
 *   2. NORMALISE company_name on Brave-sourced partners where the
 *      scraped name shares no token with the email/domain. Uses the
 *      same selectCanonicalCompanyName helper as the live route, so
 *      future renders use the right firm.
 *
 *   node scripts/cleanup-discovery-fallout.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Inlined from src/lib/discovery/clean-company-name.ts — node can't
// import .ts files without a loader; keep this in sync if the source
// changes.
const BUSINESS_SUFFIX_WORDS = [
  'logistics', 'transport', 'transports', 'construction', 'contracting',
  'services', 'service', 'group', 'partners', 'capital', 'industries',
  'industrial', 'solutions', 'systems', 'consulting', 'software', 'tech',
  'media', 'health', 'energy', 'finance', 'financial', 'legal', 'medical',
  'property', 'properties', 'realty', 'estate', 'investments', 'global',
  'international', 'australia', 'australian', 'holdings', 'enterprises',
  'corp', 'corporation', 'inc', 'pty', 'ltd', 'limited', 'co',
];
function companyNameFromDomain(domain) {
  if (!domain) return null;
  let work = String(domain).trim().toLowerCase();
  work = work.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  work = work.replace(/\.(com\.au|com|net|net\.au|org|org\.au|io|co|co\.uk|co\.nz|uk|us|de|fr|nz|au)$/i, '');
  if (!work) return null;
  let parts;
  if (/[-_.]/.test(work)) {
    parts = work.split(/[-_.]+/).filter(Boolean);
  } else {
    let split = work;
    for (const suffix of BUSINESS_SUFFIX_WORDS) {
      if (split.length > suffix.length && split.endsWith(suffix)) {
        split = split.slice(0, -suffix.length) + ' ' + suffix;
        break;
      }
    }
    parts = split.split(/\s+/).filter(Boolean);
  }
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
const JUNK_NAME_PATTERNS = [
  /^(company\s*history|about\s*(us)?|contact(\s*us)?|home(\s*page)?|services?|products?|portfolio|team|news|blog|case\s*stud(ies|y))$/i,
  /^[^|]+\|[^|]+\|[^|]+/,
  /journey of|story of|history of|guide to|introduction to/i,
  /^(.+'?s\s+)?(top|largest|best|biggest|leading)\s+\d*/i,
  /^(your|the)\s+\w+\s+(experts?|solutions?|specialists?|leaders?)\s*$/i,
  /^family[\s-]?owned\s+\w+(\s+\w+){0,5}\s+company$/i,
  /\b(powers|wins|celebrates|launches|expands|announces|acquires|partners with|secures|reveals)\s+\w/i,
];
function selectCanonicalCompanyName(scrapedName, domain) {
  const fromDomain = companyNameFromDomain(domain);
  const original = (scrapedName ?? '').toString().trim();
  if (!original) return fromDomain ? { canonical: fromDomain, source: 'domain' } : { canonical: null, source: 'none' };
  const stillJunk = JUNK_NAME_PATTERNS.some(p => p.test(original)) || original.length < 2;
  if (stillJunk) return fromDomain ? { canonical: fromDomain, source: 'domain' } : { canonical: original, source: 'scraped' };

  const domainRoot = (domain || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/\.(com\.au|com|net|net\.au|org|org\.au|io|co|co\.uk|co\.nz|uk|us|de|fr|nz|au)$/i, '')
    .replace(/[-_.]/g, '');
  if (!domainRoot) return { canonical: original, source: 'scraped' };

  const tokens = original
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);
  const hasOverlap = tokens.some(t => domainRoot.includes(t));
  if (hasOverlap) return { canonical: original, source: 'scraped' };
  return fromDomain ? { canonical: fromDomain, source: 'domain' } : { canonical: original, source: 'scraped' };
}

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

// ── Step 1: delete out_of_scope partners ──────────────────────────────
console.log('\n=== Step 1: delete out_of_scope partners ===');

const { data: oos } = await sb
  .from('partners')
  .select('id, company_name')
  .eq('organisation_id', ORG_ID)
  .ilike('category', '%out_of_scope%');

console.log(`Found ${oos?.length ?? 0} out_of_scope partners to delete.`);

if (oos && oos.length > 0) {
  const partnerIds = oos.map(p => p.id);

  // Defensive: nuke any straggling sequence_steps + outbound_messages
  // before deleting partners (in case FK is RESTRICT not CASCADE).
  const { data: stragglerSteps } = await sb
    .from('sequence_steps')
    .select('id, outbound_message_id')
    .eq('organisation_id', ORG_ID)
    .in('partner_id', partnerIds);

  if (stragglerSteps && stragglerSteps.length > 0) {
    const msgIds = stragglerSteps.map(s => s.outbound_message_id).filter(Boolean);
    if (msgIds.length > 0) {
      await sb.from('outbound_messages').delete().in('id', msgIds).eq('organisation_id', ORG_ID);
    }
    await sb.from('sequence_steps').delete().in('id', stragglerSteps.map(s => s.id)).eq('organisation_id', ORG_ID);
    console.log(`  Cleared ${stragglerSteps.length} straggling sequence_steps first.`);
  }

  const { error } = await sb
    .from('partners')
    .delete()
    .in('id', partnerIds)
    .eq('organisation_id', ORG_ID);

  if (error) {
    console.error(`  FAILED to delete partners: ${error.message}`);
    console.error('  This likely means an FK references partners. Check sequence_steps, outbound_messages, project_analysis_responses, etc.');
    process.exit(1);
  }
  console.log(`  Deleted ${partnerIds.length} out_of_scope partners.`);
}

// ── Step 2: normalise mismatched Brave company_names ──────────────────
console.log('\n=== Step 2: normalise mismatched Brave company_names ===');

const { data: bravePartners } = await sb
  .from('partners')
  .select('id, company_name, domain, contact_email, status')
  .eq('organisation_id', ORG_ID)
  .eq('source', 'brave');

console.log(`Scanning ${bravePartners?.length ?? 0} Brave-sourced partners…`);

const updates = [];
for (const p of bravePartners ?? []) {
  // Prefer email domain if present (more authoritative than scraped domain).
  const emailDomain = p.contact_email && typeof p.contact_email === 'string'
    ? p.contact_email.split('@')[1] ?? null
    : null;
  const domainToUse = emailDomain || p.domain;
  if (!domainToUse) continue;

  const canonical = selectCanonicalCompanyName(p.company_name, domainToUse);
  if (canonical.source === 'domain' && canonical.canonical && canonical.canonical !== p.company_name) {
    updates.push({
      id: p.id,
      from: p.company_name,
      to: canonical.canonical,
      domain: domainToUse,
    });
  }
}

console.log(`Found ${updates.length} partners with mismatched company_name → renormalising.`);
for (const u of updates) {
  console.log(`  ${u.from.slice(0, 50).padEnd(50)} → ${u.to}  (${u.domain})`);
}

if (updates.length > 0) {
  for (const u of updates) {
    const { error } = await sb
      .from('partners')
      .update({ company_name: u.to })
      .eq('id', u.id)
      .eq('organisation_id', ORG_ID);
    if (error) console.error(`  FAILED ${u.from}: ${error.message}`);
  }
  console.log(`Updated ${updates.length} partner.company_name fields. Pending sequence steps will render with the canonical firm name on next run.`);
}

console.log('\nDone.');
