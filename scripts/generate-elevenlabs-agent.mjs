#!/usr/bin/env node
/**
 * scripts/generate-elevenlabs-agent.mjs
 *
 * One-shot generator for the InvestorPilot ConvAI help agent.
 *
 * Usage (run from the project root with .env.local present):
 *   node --env-file=.env.local scripts/generate-elevenlabs-agent.mjs
 *
 * Reads agent name, system prompt, first message and allowed origins from
 * src/lib/elevenlabs/agent-config.ts (so the Vercel admin route at
 * /api/admin/provision-elevenlabs-agent and the .mjs scripts stay in sync).
 *
 * If this script fails with "fetch failed" / connection timeout to
 * api.elevenlabs.io (some ISPs block GCP IP ranges), use the Vercel-side
 * route instead:
 *
 *   curl -X POST https://investor-pilot-pi.vercel.app/api/admin/provision-elevenlabs-agent \
 *     -H "Cookie: <your auth cookie>" -H "Content-Type: application/json" \
 *     -d '{"mode":"create"}'
 */

import { readAgentConfig } from './_elevenlabs-config-loader.mjs';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY not set. Run with: node --env-file=.env.local scripts/generate-elevenlabs-agent.mjs');
  process.exit(1);
}

const { AGENT_NAME, SYSTEM_PROMPT, FIRST_MESSAGE, ALLOWED_ORIGINS, LANGUAGE } = readAgentConfig();

const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

async function elPost(path, body) {
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
}

async function main() {
  console.log('Creating ConvAI agent…');
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
      },
    },
  };

  const json = await elPost('/v1/convai/agents/create', body);
  const agentId = json?.agent_id;
  if (!agentId) {
    throw new Error(`No agent_id in response: ${JSON.stringify(json).slice(0, 500)}`);
  }

  console.log('\n=== DONE ===');
  console.log(`agent_id : ${agentId}`);
  console.log('\nAdd this to your .env.local AND Vercel env vars:');
  console.log(`  NEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agentId}`);
  console.log('\nThe widget in src/components/layout/elevenlabs-widget.tsx reads NEXT_PUBLIC_ELEVENLABS_AGENT_ID and renders top-right on every dashboard page.');
  console.log('\nTo iterate on the prompt later without losing this id:');
  console.log(`  node --env-file=.env.local scripts/update-elevenlabs-agent.mjs ${agentId}`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
