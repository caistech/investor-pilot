/**
 * Channel-guard middleware (audience-agnostic).
 *
 * Enforces three safety layers BEFORE any send hits Unipile / Resend:
 *   1. Kill switch — client_channels.status must be 'active'
 *   2. Daily cap — daily_send_count must be below daily_send_cap
 *   3. Warmup curve — for new accounts, daily_send_cap rises over 21 days
 *
 * Per docs/sprint-0/03-unipile-research.md: Unipile does NOT enforce LinkedIn
 * daily caps. This middleware is the only thing standing between us and a
 * LinkedIn ban event. CRITICAL — Sprint 1 deliverable per D9 and Sec 5.1 of
 * Senior Debt Brief v3.
 *
 * Warmup curve (linkedin_dm — warm + cold post-accept):
 *   Week 1   (day  1-7):  10/day
 *   Weeks 2-3 (day 8-21): 15/day
 *   Week 4+  (day 22+):   20/day
 *
 * This is tighter than the channel's nominal ceiling because LinkedIn's
 * invisible spam classifier flags templated bulk DMs to connections at
 * volumes well below the literal API throughput limit. Empirical
 * recommendation per F2K operator feedback 2026-05-14. Stays well under
 * both the in-app cap and LinkedIn's flag threshold.
 *
 * Warmup curve (linkedin_connect — cold connect requests):
 *   Day 1-7: 25% of full, day 8-14: 50%, day 15-21: 75%, day 22+: 100%
 *   (full = 20/day). Kept on percentage curve because cold connects are
 *   the highest-risk action — small absolute numbers, slow ramp.
 *
 * Warmup curve (email — Resend):
 *   Day 1-7: 25% of full, day 8-14: 50%, day 15-21: 75%, day 22+: 100%
 *   (full = 50/day). SMTP-side limits dominate; warmup matters less.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ChannelType = 'linkedin_connect' | 'linkedin_dm' | 'email';

export interface ChannelGuardResult {
  allowed: boolean;
  reason?: string;
  daily_remaining?: number;
  warmup_day?: number;
  warmup_cap?: number;
}

// Default caps per channel at FULL warmup (day 22+).
//
// linkedin_dm dropped from 30 → 20 per F2K operator decision 2026-05-14:
// LinkedIn's anti-spam classifier flags templated bulk DMs to existing
// connections at volumes below 30/day. 20/day is the empirical safe
// ceiling — gives us 50% headroom on the soft limits we observe in
// production. Operators can still override via client_channels.daily_send_cap
// for trusted/aged accounts.
const FULL_CAPS: Record<ChannelType, number> = {
  linkedin_connect: 20,
  linkedin_dm: 20,
  email: 50,
};

/**
 * Compute the effective daily cap for a channel at a given warmup day.
 *
 * linkedin_dm uses absolute thresholds (10 / 15 / 20) rather than
 * percentages because the warm-DM threshold is empirical, not derived.
 * The other two channels stay on the original quarterly percentage curve.
 */
function warmupCapForDay(channel: ChannelType, warmupDay: number): number {
  if (channel === 'linkedin_dm') {
    if (warmupDay <= 7) return 10;
    if (warmupDay <= 21) return 15;
    return 20;
  }
  const full = FULL_CAPS[channel];
  if (warmupDay <= 7) return Math.floor(full * 0.25);
  if (warmupDay <= 14) return Math.floor(full * 0.5);
  if (warmupDay <= 21) return Math.floor(full * 0.75);
  return full;
}

/**
 * Check whether a send is allowed on the given channel.
 * MUST be called before every send, no exceptions.
 *
 * Returns { allowed: false, reason } if any safety layer blocks the send.
 */
export async function checkChannelGuard(
  db: SupabaseClient,
  client_channel_id: string,
  channel: ChannelType
): Promise<ChannelGuardResult> {
  const { data: ch, error } = await db
    .from('client_channels')
    .select('status, pause_reason, daily_send_cap, daily_send_count, cap_reset_at, warmup_day')
    .eq('id', client_channel_id)
    .single();

  if (error || !ch) {
    return { allowed: false, reason: `Channel ${client_channel_id} not found` };
  }

  // Layer 1: kill switch
  if (ch.status !== 'active') {
    return {
      allowed: false,
      reason: `Channel paused: ${ch.status}${ch.pause_reason ? ' — ' + ch.pause_reason : ''}`,
    };
  }

  // Layer 2: daily cap reset if needed
  const now = new Date();
  const resetAt = ch.cap_reset_at ? new Date(ch.cap_reset_at) : null;
  let currentCount = ch.daily_send_count;
  if (!resetAt || resetAt < now) {
    // Reset the cap (caller should persist this; we just compute available)
    currentCount = 0;
  }

  // Layer 3: warmup curve takes precedence over daily_send_cap
  const warmupCap = warmupCapForDay(channel, ch.warmup_day);
  const effectiveCap = Math.min(ch.daily_send_cap, warmupCap);
  const remaining = effectiveCap - currentCount;

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `Daily cap reached (${currentCount}/${effectiveCap} on day ${ch.warmup_day} of warmup)`,
      daily_remaining: 0,
      warmup_day: ch.warmup_day,
      warmup_cap: warmupCap,
    };
  }

  return {
    allowed: true,
    daily_remaining: remaining,
    warmup_day: ch.warmup_day,
    warmup_cap: warmupCap,
  };
}

/**
 * Record a successful send — increments daily_send_count and resets the cap
 * window if needed. Call ONLY after the channel send returns ok.
 */
export async function recordChannelSend(
  db: SupabaseClient,
  client_channel_id: string
): Promise<void> {
  const now = new Date();
  // Reset window = midnight + 24h (rolling daily, sender-local timezone TBD —
  // for Sprint 1 we use UTC; Sprint 2 adds timezone-aware reset per D3)
  const nextReset = new Date(now);
  nextReset.setUTCHours(24, 0, 0, 0);

  const { data: ch } = await db
    .from('client_channels')
    .select('daily_send_count, cap_reset_at')
    .eq('id', client_channel_id)
    .single();

  if (!ch) return;

  const resetAt = ch.cap_reset_at ? new Date(ch.cap_reset_at) : null;
  const newCount = !resetAt || resetAt < now ? 1 : ch.daily_send_count + 1;
  const newResetAt = !resetAt || resetAt < now ? nextReset : ch.cap_reset_at;

  await db
    .from('client_channels')
    .update({
      daily_send_count: newCount,
      cap_reset_at: newResetAt,
    })
    .eq('id', client_channel_id);
}

/**
 * Trigger global kill switch — pause ALL channels for an organisation.
 * Use when a Unipile mass-ban event is suspected or a bad sequence is detected.
 * Per Sprint 1 D9 — operator-triggerable from dashboard.
 */
export async function killSwitch(
  db: SupabaseClient,
  organisation_id: string,
  reason: string
): Promise<{ paused_count: number }> {
  const { data, error } = await db
    .from('client_channels')
    .update({
      status: 'paused',
      pause_reason: reason,
    })
    .eq('organisation_id', organisation_id)
    .eq('status', 'active')
    .select('id');

  if (error) throw error;
  return { paused_count: data?.length || 0 };
}

/**
 * Pause a single channel (vs global kill switch). Use when health webhook
 * indicates account-specific problem (captcha, login challenge).
 */
export async function pauseChannel(
  db: SupabaseClient,
  client_channel_id: string,
  reason: string
): Promise<void> {
  await db
    .from('client_channels')
    .update({
      status: 'paused',
      pause_reason: reason,
      last_health_check_at: new Date().toISOString(),
    })
    .eq('id', client_channel_id);
}

/**
 * Resume a paused channel. Operator action.
 */
export async function resumeChannel(
  db: SupabaseClient,
  client_channel_id: string
): Promise<void> {
  await db
    .from('client_channels')
    .update({
      status: 'active',
      pause_reason: null,
    })
    .eq('id', client_channel_id);
}

/**
 * @deprecated Per-channel, send-driven warmup advance. Has two flaws:
 *   1. Relies on cap_reset_at being set, which only happens after first send
 *      (set by recordChannelSend) — fresh channels with no sends never tick.
 *   2. Increments by 1 only — if 5 calendar days passed since last advance,
 *      warmup_day still only moves 1 step.
 *
 * Prefer {@link advanceAllWarmupDays} called from the cron worker.
 */
export async function advanceWarmupDayIfNewDay(
  db: SupabaseClient,
  client_channel_id: string
): Promise<void> {
  const { data: ch } = await db
    .from('client_channels')
    .select('warmup_day, cap_reset_at')
    .eq('id', client_channel_id)
    .single();

  if (!ch) return;

  const now = new Date();
  const resetAt = ch.cap_reset_at ? new Date(ch.cap_reset_at) : null;

  if (resetAt && resetAt < now && ch.warmup_day < 22) {
    await db
      .from('client_channels')
      .update({ warmup_day: ch.warmup_day + 1 })
      .eq('id', client_channel_id);
  }
}

/**
 * Bulk warmup advance — runs in the sequencer cron. Calendar-driven: each
 * channel's warmup_day = days elapsed since created_at + 1, capped at 22+.
 *
 * Idempotent: calling multiple times in a single day is a no-op (the DB
 * already shows the correct day, no updates needed).
 *
 * Handles all the edge cases the old send-driven advance missed:
 *   - Fresh channels with no sends still progress through warmup
 *   - Channels skipped for several days catch up in one step
 *   - Restarting / reconnecting a channel doesn't reset warmup unless
 *     the operator deletes and re-creates the client_channels row
 */
export async function advanceAllWarmupDays(
  db: SupabaseClient
): Promise<{ updated: number; total: number }> {
  const { data: channels, error } = await db
    .from('client_channels')
    .select('id, created_at, warmup_day')
    .eq('status', 'active');

  if (error || !channels?.length) {
    return { updated: 0, total: 0 };
  }

  const nowMs = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  let updated = 0;

  for (const ch of channels) {
    const createdMs = new Date(ch.created_at).getTime();
    const expectedDay = Math.max(1, Math.floor((nowMs - createdMs) / msPerDay) + 1);
    if (expectedDay !== ch.warmup_day) {
      const { error: updErr } = await db
        .from('client_channels')
        .update({ warmup_day: expectedDay })
        .eq('id', ch.id);
      if (!updErr) updated++;
    }
  }

  return { updated, total: channels.length };
}
