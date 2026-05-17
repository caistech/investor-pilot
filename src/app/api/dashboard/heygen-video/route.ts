/**
 * GET /api/dashboard/heygen-video
 *
 * Returns a fresh playable URL for the dashboard hero explainer video.
 * Heygen video URLs expire 7 days after retrieval, so we never store the
 * URL itself — only the stable HEYGEN_VIDEO_ID. This route hits Heygen's
 * status endpoint on each call and returns the current URL.
 *
 * Response:
 *   { ok: true, url: string, gif_url: string | null }   — when ready
 *   { ok: false, status: 'pending'|'processing'|'failed' }
 *   { ok: false, error: string, status: 'unconfigured' } — env var missing
 *
 * In-memory cache: ~1 hour. On a cache miss the route is ~200-500ms.
 * Edge function cold start is the main latency on first request.
 */

import { NextResponse } from 'next/server';

interface HeygenStatusResponse {
  data?: {
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    video_url?: string;
    gif_url?: string | null;
    duration?: number;
  };
}

interface CacheEntry {
  url: string;
  gif_url: string | null;
  expiresAt: number;
}

let memoCache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET() {
  const apiKey = process.env.HEYGEN_API_KEY;
  const videoId = process.env.HEYGEN_VIDEO_ID;

  if (!apiKey || !videoId) {
    return NextResponse.json(
      {
        ok: false,
        status: 'unconfigured',
        error: 'HEYGEN_API_KEY or HEYGEN_VIDEO_ID not set in env. Run scripts/generate-heygen-video.mjs and set the printed video_id.',
      },
      { status: 200 },
    );
  }

  if (memoCache && memoCache.expiresAt > Date.now()) {
    return NextResponse.json({ ok: true, url: memoCache.url, gif_url: memoCache.gif_url, video_id: videoId });
  }

  try {
    const res = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { ok: false, status: 'failed', error: `Heygen ${res.status}: ${text.slice(0, 300)}` },
        { status: 200 },
      );
    }

    const json = (await res.json()) as HeygenStatusResponse;
    const status = json?.data?.status;

    if (status !== 'completed') {
      return NextResponse.json({ ok: false, status: status ?? 'pending' });
    }
    const url = json.data?.video_url;
    if (!url) {
      return NextResponse.json({ ok: false, status: 'failed', error: 'No video_url in response' });
    }

    memoCache = {
      url,
      gif_url: json.data?.gif_url ?? null,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return NextResponse.json({ ok: true, url, gif_url: memoCache.gif_url, video_id: videoId });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}
