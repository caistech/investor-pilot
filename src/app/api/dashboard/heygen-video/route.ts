/**
 * GET /api/dashboard/heygen-video
 *
 * Returns a fresh playable URL for the dashboard hero explainer video.
 *
 * Per-user personalisation flow:
 *   1. Authenticate caller, load profiles.dashboard_video_id + full_name
 *   2. If profile.dashboard_video_id exists → check Heygen status
 *      - completed → return that personalised URL
 *      - processing/pending → return the org-wide generic URL so the
 *        hero shows immediately; next reload will pick up the personal one
 *      - failed → clear the column and fall through to fresh generation
 *   3. If no personal video AND full_name is set → kick off generation
 *      with "Hi {first_name}, ..." script. Persist the new video_id to the
 *      profile. Return generic URL for now (personalised one shows on next reload).
 *   4. Otherwise → return the org-wide generic URL
 *
 * Heygen URLs expire 7 days after retrieval, so we never store URLs — only
 * the stable video_id. The fresh URL is fetched on each call.
 *
 * Response:
 *   { ok: true, url, gif_url, personalised: boolean }   — playable
 *   { ok: false, status: 'unconfigured', error }         — env missing
 *   { ok: false, status: 'pending'|'processing'|'failed' }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

interface HeygenStatusResponse {
  data?: {
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'waiting';
    video_url?: string;
    gif_url?: string | null;
  };
}

interface HeygenGenerateResponse {
  data?: { video_id?: string };
  error?: unknown;
}

const HEYGEN_BASE = 'https://api.heygen.com';
// Hardcoded to the Dennis McMahon avatar/voice that scripts/generate-heygen-video.mjs
// picked. Override via env if you've added different ones to your Heygen account.
const DEFAULT_AVATAR_ID = '2d842d82796145bdbda10a8162d2b4bc';
const DEFAULT_VOICE_ID = '0d0e1888f8aa4104a88c8ecc2844db9d';

const URL_CACHE_TTL_MS = 60 * 60 * 1000;
const urlCache = new Map<string, { url: string; gif_url: string | null; expiresAt: number }>();

function buildPersonalisedScript(firstName: string): string {
  return `Hi ${firstName}, welcome to InvestorPilot. The AI-powered platform that finds investors, opens conversations, and tracks every reply — so you can focus on closing. We use AI for everything. This video you're watching right now is AI-generated. The discovery engine uses AI to find prospects on LinkedIn. The draft writer crafts each personalised email with AI. And the conversation tracker brings it all home. Let's get started.`;
}

async function heygenStatus(apiKey: string, videoId: string): Promise<HeygenStatusResponse | null> {
  try {
    const res = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HeygenStatusResponse;
  } catch {
    return null;
  }
}

async function heygenGenerate(apiKey: string, firstName: string): Promise<string | null> {
  const avatarId = process.env.HEYGEN_AVATAR_ID || DEFAULT_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID || DEFAULT_VOICE_ID;
  try {
    const res = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_inputs: [
          {
            character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
            voice: { type: 'text', voice_id: voiceId, input_text: buildPersonalisedScript(firstName) },
            background: { type: 'color', value: '#0a0a0a' },
          },
        ],
        dimension: { width: 1280, height: 720 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as HeygenGenerateResponse;
    return json.data?.video_id ?? null;
  } catch {
    return null;
  }
}

/** Resolve a fresh URL for the given video_id, with a 1h in-memory cache per id. */
async function urlFor(apiKey: string, videoId: string): Promise<{ url: string; gif_url: string | null } | null> {
  const hit = urlCache.get(videoId);
  if (hit && hit.expiresAt > Date.now()) return { url: hit.url, gif_url: hit.gif_url };
  const status = await heygenStatus(apiKey, videoId);
  if (status?.data?.status !== 'completed' || !status.data.video_url) return null;
  const entry = { url: status.data.video_url, gif_url: status.data.gif_url ?? null, expiresAt: Date.now() + URL_CACHE_TTL_MS };
  urlCache.set(videoId, entry);
  return { url: entry.url, gif_url: entry.gif_url };
}

export async function GET() {
  const apiKey = process.env.HEYGEN_API_KEY;
  const genericVideoId = process.env.HEYGEN_VIDEO_ID;

  if (!apiKey || !genericVideoId) {
    return NextResponse.json(
      {
        ok: false,
        status: 'unconfigured',
        error: 'HEYGEN_API_KEY or HEYGEN_VIDEO_ID not set in env. Run scripts/generate-heygen-video.mjs first.',
      },
      { status: 200 },
    );
  }

  // Authenticate so we can look up + persist this caller's personal video_id.
  const { user, db, error } = await authenticateAndGetDb();
  // If unauth, fall through and serve the generic video so signed-out preview
  // pages (or middleware-allowed routes that happen to call us) still work.
  let personalVideoId: string | null = null;
  let firstName: string | null = null;

  if (!error && user) {
    const { data: profile } = await db!
      .from('profiles')
      .select('dashboard_video_id, full_name')
      .eq('id', user.id)
      .single();
    personalVideoId = (profile?.dashboard_video_id as string | null) ?? null;
    const fullName = (profile?.full_name as string | null) ?? null;
    firstName = fullName ? fullName.trim().split(/\s+/)[0] || null : null;

    // Personal video exists — try to serve it.
    if (personalVideoId) {
      const status = await heygenStatus(apiKey, personalVideoId);
      const s = status?.data?.status;
      if (s === 'completed' && status?.data?.video_url) {
        const entry = { url: status.data.video_url, gif_url: status.data.gif_url ?? null, expiresAt: Date.now() + URL_CACHE_TTL_MS };
        urlCache.set(personalVideoId, entry);
        return NextResponse.json({ ok: true, url: entry.url, gif_url: entry.gif_url, personalised: true });
      }
      if (s === 'failed') {
        // Clear and fall through to re-generation
        await db!.from('profiles').update({ dashboard_video_id: null }).eq('id', user.id);
        personalVideoId = null;
      }
      // pending/processing → fall through to generic below; next reload will catch it
    }

    // No personal video yet but we have a name → kick off generation (fire-and-forget;
    // saves video_id on success so the next reload picks it up).
    if (!personalVideoId && firstName) {
      const newVideoId = await heygenGenerate(apiKey, firstName);
      if (newVideoId) {
        await db!.from('profiles').update({ dashboard_video_id: newVideoId }).eq('id', user.id);
      }
    }
  }

  // Default path: serve the org-wide generic video.
  const generic = await urlFor(apiKey, genericVideoId);
  if (!generic) {
    return NextResponse.json({ ok: false, status: 'pending' });
  }
  return NextResponse.json({ ok: true, url: generic.url, gif_url: generic.gif_url, personalised: false });
}
