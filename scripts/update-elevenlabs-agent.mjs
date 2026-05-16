#!/usr/bin/env node
/**
 * scripts/update-elevenlabs-agent.mjs
 *
 * Iterates on an existing ConvAI agent's prompt / first_message / allowed
 * origins without losing the agent_id. Use this whenever you want to tweak
 * what the help agent knows or how it speaks, so the NEXT_PUBLIC_ELEVENLABS_AGENT_ID
 * env var stays stable and the widget keeps working.
 *
 * Usage (run from the project root with .env.local present):
 *   node --env-file=.env.local scripts/update-elevenlabs-agent.mjs <agent_id>
 *
 * The agent_id is the value of NEXT_PUBLIC_ELEVENLABS_AGENT_ID in your
 * .env.local. If you don't have it, look it up in the ElevenLabs dashboard
 * (Conversational AI → your agent) or re-run generate-elevenlabs-agent.mjs.
 *
 * This script reads the SAME constants as generate-elevenlabs-agent.mjs so
 * the two stay in sync — edit the prompt there, run this script to apply.
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

// Re-import the agent configuration from the generator to keep both scripts
// in lockstep. If you fork the prompt between the two, you'll drift.
// dynamic import here so node --env-file doesn't try to evaluate the file
// before env is loaded.
const generator = await import('./generate-elevenlabs-agent.mjs').catch(() => null);

// Fall back to embedding minimal config if the import shape changes — the
// generator file exports nothing today, so we read its source via fs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
void generator; // future: switch generator to export consts and use directly

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatorSrc = await readFile(resolve(__dirname, 'generate-elevenlabs-agent.mjs'), 'utf8');

function extractConst(name) {
  const re = new RegExp(`const ${name} = \\\`([\\s\\S]*?)\\\`;`, 'm');
  const m = generatorSrc.match(re);
  if (!m) {
    const strRe = new RegExp(`const ${name} = "([^"]*)";`, 'm');
    const sm = generatorSrc.match(strRe);
    return sm ? sm[1] : null;
  }
  return m[1];
}
function extractArray(name) {
  const re = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`, 'm');
  const m = generatorSrc.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
}

const AGENT_NAME = extractConst('AGENT_NAME');
const SYSTEM_PROMPT = extractConst('SYSTEM_PROMPT');
const FIRST_MESSAGE = extractConst('FIRST_MESSAGE');
const ALLOWED_ORIGINS = extractArray('ALLOWED_ORIGINS');

if (!AGENT_NAME || !SYSTEM_PROMPT || !FIRST_MESSAGE) {
  console.error('Could not parse agent config from generate-elevenlabs-agent.mjs — keep both scripts in the same directory.');
  process.exit(1);
}

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: node --env-file=.env.local scripts/update-elevenlabs-agent.mjs <agent_id>');
  console.error('agent_id is the value of NEXT_PUBLIC_ELEVENLABS_AGENT_ID in .env.local');
  process.exit(1);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY not set. Run with: node --env-file=.env.local scripts/update-elevenlabs-agent.mjs <agent_id>');
  process.exit(1);
}

const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

async function elPatch(path, body) {
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
}

async function main() {
  console.log(`Updating ConvAI agent ${agentId}…`);
  console.log(`  name        : ${AGENT_NAME}`);
  console.log(`  prompt chars: ${SYSTEM_PROMPT.length}`);
  console.log(`  origins     : ${ALLOWED_ORIGINS.join(', ')}`);

  const body = {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
        },
        first_message: FIRST_MESSAGE,
        language: 'en',
      },
    },
    platform_settings: {
      widget: {
        allowlist: ALLOWED_ORIGINS.map((origin) => ({ hostname: new URL(origin).hostname })),
      },
    },
  };

  await elPatch(`/v1/convai/agents/${agentId}`, body);

  console.log('\n=== DONE ===');
  console.log(`Updated agent_id : ${agentId}`);
  console.log('Reload the dashboard to see the new prompt in action.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
