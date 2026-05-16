/**
 * POST /api/admin/provision-elevenlabs-agent
 *
 * Server-side ElevenLabs ConvAI agent provisioning. Mirrors the local
 * scripts/generate-elevenlabs-agent.mjs script, but runs on Vercel — which
 * has no firewall issues reaching api.elevenlabs.io.
 *
 * Use this when the local script fails with "fetch failed" / connection
 * timeout to ElevenLabs (some ISPs block GCP IP ranges).
 *
 * Auth: requires a logged-in user whose email matches PLATFORM_ADMIN_EMAIL
 * (defaults to mcmdennis@gmail.com). Set the env var to override per-deploy.
 *
 * Body (optional):
 *   { mode: 'create' | 'update', agent_id?: string }
 *
 * Returns:
 *   { ok: true, agent_id: string }                    on success
 *   { error: string }                                 on failure
 *
 * After running, copy the agent_id into Vercel env as:
 *   NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<agent_id>
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import {
  AGENT_NAME,
  SYSTEM_PROMPT,
  FIRST_MESSAGE,
  ALLOWED_ORIGINS,
  LANGUAGE,
} from '@/lib/elevenlabs/agent-config';

const DEFAULT_ADMIN_EMAIL = 'mcmdennis@gmail.com';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

export async function POST(request: Request) {
  const { user, error } = await authenticateAndGetDb();
  if (error) return error;

  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  if (user!.email !== adminEmail) {
    return NextResponse.json(
      { error: `Forbidden — this route is restricted to ${adminEmail}` },
      { status: 403 },
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ELEVENLABS_API_KEY env var not set on this deploy' },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const mode: 'create' | 'update' = body.mode === 'update' ? 'update' : 'create';
  const existingAgentId: string | undefined = body.agent_id;

  if (mode === 'update' && !existingAgentId) {
    return NextResponse.json(
      { error: 'mode=update requires agent_id in body' },
      { status: 400 },
    );
  }

  const payload = {
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

  const path = mode === 'update'
    ? `/v1/convai/agents/${existingAgentId}`
    : '/v1/convai/agents/create';
  const method = mode === 'update' ? 'PATCH' : 'POST';

  try {
    const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
      method,
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `ElevenLabs ${res.status}: ${text.slice(0, 500)}` },
        { status: 502 },
      );
    }
    let json: { agent_id?: string };
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `ElevenLabs returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const agentId = json.agent_id ?? existingAgentId;
    if (!agentId) {
      return NextResponse.json(
        { error: `No agent_id in response: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      mode,
      agent_id: agentId,
      next_step: `Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agentId} in Vercel env vars, then redeploy.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
