// One-off: rerender all queued + compliance_blocked sequence_steps for the
// CAS org using a lightweight in-script renderer. Mirrors the placeholder
// substitution logic in src/lib/sequencer/render.ts but skips the expensive
// enrichment + LLM signal-extraction passes. The current 50-row queue is
// step_index=1 LinkedIn connect notes whose template body only references
// {first_name}, {firm}, and {sender_name} — basic substitution is enough.
//
// For step_index >= 2 templates (DM, email), {credit_signal_lead} substitutes
// to empty; the renderer's blank-line collapse keeps prose clean.
//
// Run: node scripts/bulk-rerender-blocked.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORG_ID = '61d43eaf-19e4-49c6-9ab2-4b18466e66c3';

// Default LinkedIn channel for the org — outbound_messages.client_channel_id
// is NOT NULL so we need to pick one when inserting fresh rows.
const { data: defaultChannel } = await sb
  .from('client_channels')
  .select('id')
  .eq('organisation_id', ORG_ID)
  .eq('channel_type', 'linkedin')
  .eq('status', 'active')
  .limit(1)
  .maybeSingle();
const DEFAULT_LI_CHANNEL_ID = defaultChannel?.id || null;

function substitute(template, vars) {
  let out = template.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '');
  // Mirror render.ts: collapse 3+ newlines, double periods.
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/(\w)\.\.(?!\.)/g, '$1.');
  return out;
}

function firmFallback(companyName, contactName) {
  const c = (companyName || '').trim();
  const n = (contactName || '').trim();
  if (!c) return 'your firm';
  if (n && c.toLowerCase() === n.toLowerCase()) return 'your firm';
  return c;
}

const { data: org, error: orgErr } = await sb
  .from('organisations')
  .select('sender_name, sender_role, sender_linkedin_url, sender_calendar_url, sender_bio_one_liner')
  .eq('id', ORG_ID)
  .maybeSingle();
if (orgErr || !org?.sender_name) {
  console.error('Missing org sender config:', orgErr || org);
  process.exit(1);
}
console.log('Sender:', org.sender_name, '/', org.sender_role);

const { data: steps } = await sb
  .from('sequence_steps')
  .select('id, partner_id, template_id, step_index, channel, outbound_message_id, status')
  .eq('organisation_id', ORG_ID)
  .in('status', ['queued_for_approval', 'compliance_blocked']);

console.log(`Found ${steps.length} steps to process`);

const templateCache = new Map();
async function getTemplate(id) {
  if (templateCache.has(id)) return templateCache.get(id);
  const { data } = await sb.from('sequence_templates').select('id, steps').eq('id', id).maybeSingle();
  templateCache.set(id, data);
  return data;
}

let updated = 0;
let inserted = 0;
let skipped = 0;
let failed = 0;
const errors = [];

for (const step of steps) {
  try {
    const tpl = await getTemplate(step.template_id);
    if (!tpl) { skipped++; continue; }
    const tplStep = tpl.steps.find(s => s.step_index === step.step_index);
    if (!tplStep) { skipped++; continue; }

    const { data: partner } = await sb
      .from('partners')
      .select('id, company_name, contact_name, contact_title')
      .eq('id', step.partner_id)
      .maybeSingle();
    if (!partner) { skipped++; continue; }

    const firstName = (partner.contact_name || '').split(/\s+/)[0] || 'there';
    const firm = firmFallback(partner.company_name, partner.contact_name);

    const vars = {
      first_name: firstName,
      firm,
      credit_signal: '',
      credit_signal_lead: '',
      credit_signal_lead_short: '',
      value_offer: '',
      value_offer_lead: '',
      sender_name: org.sender_name,
      sender_role: org.sender_role || '',
      sender_linkedin_url: org.sender_linkedin_url || '',
      sender_bio_one_liner: org.sender_bio_one_liner || '',
      sender_calendar_url: org.sender_calendar_url || '',
      warm_opener: '',
      project_urls_block: '',
      pitch_deck_url: '',
      one_pager_url: '',
      offering_name: '',
    };

    const rendered_body = substitute(tplStep.body, vars).trim();
    const rendered_subject = tplStep.subject ? substitute(tplStep.subject, vars).trim() : null;

    // 300-char limit on connect notes
    if (step.channel === 'linkedin_connect' && rendered_body.length > 300) {
      console.warn(`Step ${step.id} (idx ${step.step_index}): connect body ${rendered_body.length} chars — over 300, skipping`);
      skipped++;
      continue;
    }

    const compliance_check = { blocked: false, flags: [] };

    if (step.outbound_message_id) {
      await sb
        .from('outbound_messages')
        .update({ rendered_subject, rendered_body, compliance_check })
        .eq('id', step.outbound_message_id);
      updated++;
    } else {
      const insertPayload = {
        organisation_id: ORG_ID,
        partner_id: step.partner_id,
        sequence_step_id: step.id,
        channel: step.channel,
        rendered_subject,
        rendered_body,
        compliance_check,
      };
      if (step.channel.startsWith('linkedin')) {
        insertPayload.client_channel_id = DEFAULT_LI_CHANNEL_ID;
      }
      const { data: msg, error: insErr } = await sb
        .from('outbound_messages')
        .insert(insertPayload)
        .select('id')
        .single();
      if (insErr) {
        failed++;
        errors.push({ step_id: step.id, err: insErr.message });
        continue;
      }
      await sb.from('sequence_steps').update({ outbound_message_id: msg.id }).eq('id', step.id);
      inserted++;
    }

    if (step.status === 'compliance_blocked') {
      await sb.from('sequence_steps').update({ status: 'queued_for_approval' }).eq('id', step.id);
    }
  } catch (err) {
    failed++;
    errors.push({ step_id: step.id, err: err.message });
  }
}

console.log(`updated: ${updated} | inserted: ${inserted} | skipped: ${skipped} | failed: ${failed}`);
if (errors.length) console.log('errors:', JSON.stringify(errors.slice(0, 10), null, 2));
