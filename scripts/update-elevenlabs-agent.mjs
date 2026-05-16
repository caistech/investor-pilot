#!/usr/bin/env node
/**
 * scripts/update-elevenlabs-agent.mjs
 *
 * Iterates on an existing ConvAI agent's prompt / first_message / allowed
 * origins without losing the agent_id. Use this whenever you want to tweak
 * the help agent — NEXT_PUBLIC_ELEVENLABS_AGENT_ID stays stable, the widget
 * keeps working, the new prompt is live on next conversation start.
 *
 * Usage (run from the project root with .env.local present):
 *   node --env-file=.env.local scripts/update-elevenlabs-agent.mjs <agent_id>
 *
 * Reads the agent config from src/lib/elevenlabs/agent-config.ts — edit
 * the prompt / first message there, then re-run this script.
 *
 * If this script fails with "fetch failed" to api.elevenlabs.io (some ISPs
 * block GCP IP ranges), use the Vercel-side admin route instead:
 *
 *   curl -X POST https://investor-pilot-pi.vercel.app/api/admin/provision-elevenlabs-agent \
 *     -H "Cookie: <your auth cookie>" -H "Content-Type: application/json" \
 *     -d '{"mode":"update","agent_id":"<your agent_id>"}'
 */

import { readAgentConfig } from './_elevenlabs-config-loader.mjs';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

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

const { AGENT_NAME, SYSTEM_PROMPT, FIRST_MESSAGE, ALLOWED_ORIGINS, LANGUAGE, WIDGET_PLACEMENT } = readAgentConfig();

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
        prompt: { prompt: SYSTEM_PROMPT },
        first_message: FIRST_MESSAGE,
        language: LANGUAGE,
      },
    },
    platform_settings: {
      widget: {
        allowlist: ALLOWED_ORIGINS.map((origin) => ({ hostname: new URL(origin).hostname })),
        placement: WIDGET_PLACEMENT,
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
