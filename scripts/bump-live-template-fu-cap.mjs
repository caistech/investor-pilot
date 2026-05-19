/**
 * One-off: bump auto_dm_fu (step 5) max_chars from 600 → 800 on the
 * currently-active sequence templates. The LLM was producing 691-char
 * follow-up DMs and the render guard rejected them. STEP_SCAFFOLD now
 * defaults to 800 for new templates; this script catches existing rows.
 *
 *   node scripts/bump-live-template-fu-cap.mjs
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

const { data: tpls } = await sb
  .from('sequence_templates')
  .select('id, name, is_active, steps')
  .eq('organisation_id', ORG_ID)
  .eq('is_active', true);

console.log(`Found ${tpls?.length ?? 0} active templates.`);

for (const t of tpls ?? []) {
  if (!Array.isArray(t.steps)) {
    console.log(`  skipping ${t.name} — no steps array`);
    continue;
  }
  let changed = false;
  const updatedSteps = t.steps.map((s) => {
    if (s.template_key === 'auto_dm_fu' && s.max_chars && s.max_chars < 800) {
      console.log(`  ${t.name} step ${s.step_index} (${s.template_key}): max_chars ${s.max_chars} → 800`);
      changed = true;
      return { ...s, max_chars: 800 };
    }
    return s;
  });
  if (!changed) {
    console.log(`  ${t.name} — no change needed`);
    continue;
  }
  const { error } = await sb
    .from('sequence_templates')
    .update({ steps: updatedSteps })
    .eq('id', t.id);
  if (error) console.error(`  UPDATE failed: ${error.message}`);
  else console.log(`  ✓ updated`);
}
