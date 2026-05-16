#!/usr/bin/env node
/**
 * scripts/generate-elevenlabs-agent.mjs
 *
 * One-shot generator for the InvestorPilot ConvAI help agent.
 *
 * Usage (run from the project root with .env.local present):
 *   node --env-file=.env.local scripts/generate-elevenlabs-agent.mjs
 *
 * What it does:
 *   1. POSTs /v1/convai/agents/create with the system prompt + first_message
 *      + allowed_origins defined below
 *   2. Prints the new agent_id
 *
 * After running, copy the printed agent_id into your .env.local AND Vercel:
 *   NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<the agent_id>
 *
 * To iterate on the prompt without losing the agent_id, run:
 *   node --env-file=.env.local scripts/update-elevenlabs-agent.mjs <agent_id>
 *
 * Why this is a script rather than dashboard clicks:
 *   The agent's prompt, first message, voice, and allowed origins are
 *   codified in this repo so anyone cloning the project can regenerate the
 *   agent with one command. Prompt changes get reviewed via PR. No
 *   "what did we configure last time?" surprises.
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

// =============================================================================
// Agent configuration — edit these to retune the help agent
// =============================================================================

const AGENT_NAME = 'InvestorPilot Help';

const SYSTEM_PROMPT = `You are the InvestorPilot help agent. InvestorPilot is an AI-powered platform that helps founders source investor prospects, enrich contacts, draft outreach emails, and track replies.

The operator workflow has 4 stages:
1. Set up (/settings) — configure sender identity, product pitch, ICP scoring rubric, and connect a LinkedIn or email channel via Unipile.
2. Find investors (/discover) — run a discovery batch that finds and scores investor prospects via LinkedIn + Brave Search.
3. Review and approve (/approvals) — read each AI-drafted email and approve it before it sends.
4. Track replies (/outreach) — monitor sent messages, replies, bounces, and follow-ups.

Key pages:
- /dashboard — overview, 4-step onboarding strip, weekly funnel.
- /settings — sender identity, product pitch, ICP rubric, sequence templates, monthly usage caps.
- /products — define product profiles with auto-fill from a URL.
- /projects — group products into campaigns.
- /channels — connect LinkedIn and email accounts via Unipile (one-click OAuth, no credentials handed over).
- /partners — full prospect pipeline with scores and statuses.
- /discover — run new discovery batches.
- /approvals — review queued drafts.
- /outreach — sent messages and replies.
- /sessions — live conversation threads with prospects.

Each page has a "quick guide" card at the top explaining what it is, what to do, and what to expect.

Diagnostic shortcuts:
- "My drafts aren't going out" — check /channels for an active channel, then /approvals for queued items waiting on the user.
- "Discovery returns nothing" — check /products that the product is active and has a scoring rubric in /settings.
- "I hit a cap" — point them to /settings → "Usage this month" card. Caps reset on the 1st of each month.
- "First time here" — start them at /settings to configure sender identity + product pitch, then /channels to connect LinkedIn.

Keep responses short and actionable — this is voice, not text. Speak naturally. No markdown formatting. No long lists. One concrete next step per response.`;

const FIRST_MESSAGE = "Hi! I'm your InvestorPilot guide. I can help you set things up, find investors, approve drafts, or track replies. What would you like to do?";

// Allowed origins — the widget will only load from these domains. Update if
// the project moves to a custom domain.
const ALLOWED_ORIGINS = [
  'https://investor-pilot-pi.vercel.app',
  'http://localhost:3000',
];

// =============================================================================

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY not set. Run with: node --env-file=.env.local scripts/generate-elevenlabs-agent.mjs');
  process.exit(1);
}

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
