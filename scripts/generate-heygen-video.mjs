#!/usr/bin/env node
/**
 * scripts/generate-heygen-video.mjs
 *
 * One-shot generator for the dashboard hero explainer video.
 *
 * Usage (must be run from the project root with .env.local present):
 *   node --env-file=.env.local scripts/generate-heygen-video.mjs
 *
 * Or, if you've already exported HEYGEN_API_KEY in your shell:
 *   HEYGEN_API_KEY=... node scripts/generate-heygen-video.mjs
 *
 * What it does:
 *   1. Lists Heygen avatars + voices, picks the first usable English pair
 *   2. Submits POST /v2/video/generate with the SCRIPT below
 *   3. Polls GET /v1/video_status.get every 20s (up to 15 minutes)
 *   4. Prints the video_id + final mp4 URL when status === completed
 *
 * After running, copy the printed video_id into your .env.local:
 *   HEYGEN_VIDEO_ID=<the_video_id>
 *
 * The /api/dashboard/heygen-video route reads HEYGEN_VIDEO_ID and re-fetches
 * the playable URL from Heygen on demand (URLs expire after 7 days, so we
 * never store a hardcoded URL — only the stable id).
 */

const HEYGEN_BASE = 'https://api.heygen.com';
const POLL_INTERVAL_MS = 20_000;
const POLL_MAX_MS = 15 * 60 * 1000;

const SCRIPT = `Welcome to InvestorPilot. The AI-powered platform that finds the right people, writes them a personalised message in their own language, and tracks every reply — so you can focus on closing. InvestorPilot runs in two modes. Use Projects to find investors and capital providers for what you're raising. Use Products to find customers, channel partners, and resellers for what you sell. Same engine, same workflow. Every prospect gets a message tuned to their fit score and translated into their language — fourteen supported, from Vietnamese and Japanese to Arabic and Brazilian Portuguese — with the English original one click away for review. For your sponsor or board, every Project and Product generates a one-page Pool Summary: scored count, geographic and language distribution, top prospects, narrative insights. Print to PDF and hand it on. Run it solo, or invite your team. Templates and prospects stay shared; outreach goes from each member's own LinkedIn and inbox. Every send is human-approved, every action is audit-logged. This video is AI-generated. Let's get started.`;

const apiKey = process.env.HEYGEN_API_KEY;
if (!apiKey) {
  console.error('HEYGEN_API_KEY not set. Run with: node --env-file=.env.local scripts/generate-heygen-video.mjs');
  process.exit(1);
}

const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

/** GET helper that throws on non-2xx. */
async function hgGet(path) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Heygen ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
}

/** POST helper that throws on non-2xx. */
async function hgPost(path, body) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Heygen ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
}

async function pickAvatarAndVoice() {
  console.log('Listing avatars + voices…');
  const [avatars, voices] = await Promise.all([
    hgGet('/v2/avatars'),
    hgGet('/v2/voices'),
  ]);

  // Pick first avatar from the avatars list (any free-tier-usable one will do).
  const avatarList = avatars?.data?.avatars ?? [];
  const avatar = avatarList[0];
  if (!avatar?.avatar_id) throw new Error('No avatars returned by Heygen — check your account access');

  // Prefer an English voice; fall back to first available.
  const voiceList = voices?.data?.voices ?? [];
  const englishVoice =
    voiceList.find((v) => /^en[-_]/i.test(v.language || '') || /english/i.test(v.language || '')) ||
    voiceList[0];
  if (!englishVoice?.voice_id) throw new Error('No voices returned by Heygen — check your account access');

  console.log(`  avatar: ${avatar.avatar_id} (${avatar.avatar_name || 'unnamed'})`);
  console.log(`  voice : ${englishVoice.voice_id} (${englishVoice.name || englishVoice.language || 'unnamed'})`);
  return { avatarId: avatar.avatar_id, voiceId: englishVoice.voice_id };
}

async function generate(avatarId, voiceId) {
  console.log(`Submitting video generation (${SCRIPT.length} chars script)…`);
  const body = {
    video_inputs: [
      {
        character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
        voice: { type: 'text', voice_id: voiceId, input_text: SCRIPT },
        background: { type: 'color', value: '#0a0a0a' },
      },
    ],
    dimension: { width: 1280, height: 720 },
  };
  const json = await hgPost('/v2/video/generate', body);
  const videoId = json?.data?.video_id;
  if (!videoId) throw new Error(`No video_id in response: ${JSON.stringify(json).slice(0, 300)}`);
  console.log(`  video_id: ${videoId}`);
  return videoId;
}

async function poll(videoId) {
  console.log(`Polling status every ${POLL_INTERVAL_MS / 1000}s (max ${POLL_MAX_MS / 60000} min)…`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_MAX_MS) {
    const json = await hgGet(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    const status = json?.data?.status;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`  [${elapsed}s] status=${status}\n`);
    if (status === 'completed') {
      return json.data;
    }
    if (status === 'failed') {
      throw new Error(`Heygen generation failed: ${JSON.stringify(json.data).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${POLL_MAX_MS / 60000} minutes — video_id=${videoId}, check Heygen dashboard`);
}

async function main() {
  const { avatarId, voiceId } = await pickAvatarAndVoice();
  const videoId = await generate(avatarId, voiceId);
  const result = await poll(videoId);
  console.log('\n=== DONE ===');
  console.log(`video_id  : ${videoId}`);
  console.log(`video_url : ${result.video_url}`);
  console.log(`gif_url   : ${result.gif_url || '(none)'}`);
  console.log(`duration  : ${result.duration || '?'}s`);
  console.log('\nAdd this to your .env.local (and to Vercel env vars):');
  console.log(`  HEYGEN_VIDEO_ID=${videoId}`);
  console.log('\nThe /api/dashboard/heygen-video route uses HEYGEN_VIDEO_ID + HEYGEN_API_KEY to fetch a fresh playable URL on demand (Heygen URLs expire after 7 days).');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
