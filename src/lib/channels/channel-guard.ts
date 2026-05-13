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
 * Warmup curve: day 1-7 = 5/day, day 8-14 = 10/day, day 15-21 = 15/day,
 * day 22+ = full cap (default 20/day LinkedIn connects, 30/day DMs, 50/day email).
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

// Default caps per channel (after warmup). Values per docs/sprint-0/03-unipile-research.md.
const FULL_CAPS: Record<ChannelType, number> = {
  linkedin_connect: 20,
  linkedin_dm: 30,
  email: 50,
};

// Warmup curve — fraction of full cap by day
// Day 1-7: 25%, day 8-14: 50%, day 15-21: 75%, day 22+: 100%
function warmupCapForDay(channel: ChannelType, warmupDay: number): number {
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
 * Advance warmup day. Should run daily via cron OR on first send of each new day.
 * Simpler: increment on first send of each new UTC day per channel.
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

  // If the reset window has passed (new UTC day), advance warmup day
  if (resetAt && resetAt < now && ch.warmup_day < 22) {
    await db
      .from('client_channels')
      .update({ warmup_day: ch.warmup_day + 1 })
      .eq('id', client_channel_id);
  }
}
