#!/usr/bin/env node
/**
 * One-shot CSV → partners import for the Thesis Driven Capital Stack
 * family-office databases (and any future CSV with the same shape).
 *
 * Usage:
 *   node scripts/import-investors.mjs "path/to/csv.csv" [--filter=branscombe-fit]
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local. Maps the
 * Thesis Driven schema:
 *   Investor, Type, Asset Classes, Sub-Asset Classes, Deal Format,
 *   Risk Profile, Contacts Names, Contacts emails, Location,
 *   Investment Regions, Website, Investor Blurb, Management Generation,
 *   Wealth Origin
 *
 * → partners columns:
 *   company_name, partner_type=lender, source=manual, status=contact_found,
 *   category=Type, contact_name=first contact, contact_email=first email,
 *   domain=email-derived, weighted_score=5.0 (passes ICP gate),
 *   confidence_score=low-confidence (operator should verify),
 *   *_notes mapped from CSV fields for the Prospect detail view
 *
 * Dedup by (organisation_id, domain). Re-running is safe — duplicates are
 * skipped, not overwritten.
 *
 * --filter=branscombe-fit retains only rows where Asset Classes mentions
 * Multifamily / Single Family / Niche-Other AND Deal Format mentions
 * Debt or LP Equity or Joint Venture. Drops pure-equity-only / pure-VC rows.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const filterArg = args.find(a => a.startsWith('--filter='))?.split('=')[1] || '';
const orgIdArg = args.find(a => a.startsWith('--org='))?.split('=')[1] || '';

if (!csvPath) {
  console.error('Usage: node scripts/import-investors.mjs "path/to/csv.csv" [--filter=branscombe-fit] [--org=<uuid>]');
  process.exit(1);
}

// Load .env.local manually (no dotenv dep)
const envText = await readFile(resolve('.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) return null;
      const k = line.slice(0, eqIdx).trim();
      let v = line.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [k, v];
    })
    .filter(Boolean),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Resolve org id. Pass --org=<uuid> to override; else use the first row from
// organisations (this project has only one).
let orgId = orgIdArg;
if (!orgId) {
  const { data: orgs } = await db.from('organisations').select('id, name').limit(2);
  if (!orgs || orgs.length === 0) {
    console.error('No organisations table rows found.');
    process.exit(1);
  }
  if (orgs.length > 1) {
    console.error('Multiple organisations found — pass --org=<uuid>:');
    for (const o of orgs) console.error(`  ${o.id}  ${o.name}`);
    process.exit(1);
  }
  orgId = orgs[0].id;
  console.log(`Using organisation_id=${orgId} (${orgs[0].name})`);
}

// =============================================================================
// CSV parser — RFC 4180 with quoted fields, escaped quotes ("")
// =============================================================================
function parseCsv(text) {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') {
      row.push(field); rows.push(row);
      row = []; field = ''; i++; continue;
    }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const csvText = await readFile(resolve(csvPath), 'utf8');
const rows = parseCsv(csvText);
if (rows.length < 2) {
  console.error('CSV has fewer than 2 rows');
  process.exit(1);
}

const header = rows[0].map(h => h.trim());
const records = rows.slice(1)
  .filter(r => r.length >= header.length / 2)
  .map(r => Object.fromEntries(header.map((h, idx) => [h, (r[idx] || '').trim()])));

console.log(`Parsed ${records.length} rows from ${csvPath}`);

// =============================================================================
// Filtering (optional) — Branscombe-fit
// =============================================================================
function isBranscombeFit(rec) {
  const ac = (rec['Asset Classes'] || '').toLowerCase();
  const df = (rec['Deal Format'] || '').toLowerCase();
  const hasResidential = /multifamily|single family|niche|residential|btr|build/i.test(ac);
  const hasDebtOrEquity = /debt|lp equity|joint venture|co-gp|structured equity|preferred/i.test(df);
  return hasResidential && hasDebtOrEquity;
}

const filtered = filterArg === 'branscombe-fit' ? records.filter(isBranscombeFit) : records;
console.log(`After filter (${filterArg || 'none'}): ${filtered.length} rows`);

// =============================================================================
// Map CSV row → partners insert
// =============================================================================
function extractDomain(email, websiteRaw) {
  if (email && email.includes('@')) {
    const d = email.split('@')[1].split(/[,\s;]/)[0].toLowerCase().trim();
    if (d && d.length > 3 && d.includes('.')) return d;
  }
  if (websiteRaw) {
    let w = websiteRaw.trim();
    if (!/^https?:\/\//.test(w)) w = `https://${w}`;
    try {
      const u = new URL(w);
      return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  }
  return '';
}

const mapped = filtered.map(rec => {
  const contactNames = (rec['Contacts Names'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const contactEmails = (rec['Contacts emails'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const firstName = contactNames[0] || null;
  const firstEmail = contactEmails[0] || null;
  const domain = extractDomain(firstEmail, rec['Website'] || '');
  const company = (rec['Investor'] || '').trim().replace(/\s*,\s*$/, '');

  return {
    organisation_id: orgId,
    company_name: company,
    domain: domain || `imported-${company.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    partner_type: 'lender',
    source: 'manual',
    status: firstEmail ? 'contact_found' : 'scored',
    category: rec['Type']?.trim() || 'family office',
    weighted_score: 5.0,
    confidence_score: 'low-confidence',
    contact_name: firstName,
    contact_email: firstEmail,
    contact_source: 'thesis_driven_csv',
    email_status: firstEmail ? 'verified' : null,
    email_confidence: firstEmail ? 80 : null,
    audience_overlap_notes: [
      rec['Asset Classes'] ? `Asset classes: ${rec['Asset Classes']}` : '',
      rec['Investment Regions'] ? `Regions: ${rec['Investment Regions']}` : '',
    ].filter(Boolean).join(' · '),
    complementarity_notes: rec['Sub-Asset Classes'] || rec['Deal Format'] || '',
    partner_readiness_notes: [
      rec['Risk Profile'] ? `Risk: ${rec['Risk Profile']}` : '',
      rec['Management Generation'] ? `Gen: ${rec['Management Generation']}` : '',
    ].filter(Boolean).join(' · '),
    reachability_notes: rec['Location'] || '',
    strategic_leverage_notes: [
      rec['Wealth Origin'] ? rec['Wealth Origin'].slice(0, 500) : '',
      rec['Investor Blurb'] ? `\n\n${rec['Investor Blurb'].slice(0, 800)}` : '',
    ].filter(Boolean).join(''),
  };
}).filter(p => p.company_name && p.company_name.length > 1);

console.log(`Prepared ${mapped.length} partner inserts`);

// =============================================================================
// Dedup against existing partners — fetch existing domains first
// =============================================================================
const allDomains = Array.from(new Set(mapped.map(m => m.domain)));
const existing = new Set();
for (let i = 0; i < allDomains.length; i += 200) {
  const slice = allDomains.slice(i, i + 200);
  const { data } = await db.from('partners').select('domain').eq('organisation_id', orgId).in('domain', slice);
  (data || []).forEach(r => existing.add(r.domain));
}
const toInsert = mapped.filter(p => !existing.has(p.domain));
console.log(`After dedup: ${toInsert.length} new (${mapped.length - toInsert.length} already in DB)`);

// =============================================================================
// Bulk insert in chunks of 100
// =============================================================================
let inserted = 0;
let errors = 0;
const errorSamples = [];
for (let i = 0; i < toInsert.length; i += 100) {
  const chunk = toInsert.slice(i, i + 100);
  const { data, error } = await db.from('partners').insert(chunk).select('id');
  if (error) {
    errors += chunk.length;
    errorSamples.push(error.message);
  } else {
    inserted += data?.length || 0;
  }
}

console.log(`\n========================================`);
console.log(`Insert summary`);
console.log(`========================================`);
console.log(`Mapped:    ${mapped.length}`);
console.log(`Skipped (already in DB): ${mapped.length - toInsert.length}`);
console.log(`Inserted:  ${inserted}`);
console.log(`Errors:    ${errors}`);
if (errorSamples.length > 0) {
  console.log(`Error samples (first 3):`);
  Array.from(new Set(errorSamples)).slice(0, 3).forEach(e => console.log(`  - ${e}`));
}
console.log(`========================================\n`);
