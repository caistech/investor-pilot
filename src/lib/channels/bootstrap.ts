/**
 * Email channel bootstrap.
 *
 * Resend is env-driven (no OAuth) so a new org has email-sending capability
 * the moment RESEND_API_KEY is set in Vercel. But the sequencer gates on a
 * client_channels row of type='email' before it'll render email-touch steps.
 * Migration 043 backfilled the canonical existing orgs; this helper is the
 * structural fix for future org creates so the gate never re-appears.
 *
 * Called from every code path that creates a brand-new organisation row:
 *   - src/app/(dashboard)/layout.tsx (ensureOrgAndProfile backstop)
 *   - src/app/auth/callback/route.ts (fresh-org branch)
 *
 * Idempotent via ON CONFLICT on the existing
 * (organisation_id, channel_type, account_identifier) unique constraint.
 * Safe to call when the row already exists.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const CANONICAL_RESEND_SENDER = 'noreply@updates.corporateaisolutions.com';

export async function bootstrapEmailChannel(
  admin: SupabaseClient,
  organisationId: string,
  ownerUserId: string,
): Promise<void> {
  // RESEND_FROM_EMAIL is the source of truth for the actual sender at
  // runtime; the column on client_channels is cosmetic for identification.
  // Default to the canonical CAS sender per the Email Infrastructure rule.
  const identifier = process.env.RESEND_FROM_EMAIL || CANONICAL_RESEND_SENDER;

  await admin.from('client_channels').upsert(
    {
      organisation_id: organisationId,
      user_id: ownerUserId,
      channel_type: 'email',
      provider: 'resend',
      account_identifier: identifier,
      status: 'active',
      daily_send_cap: 50,
      daily_send_count: 0,
      // Bypass the 21-day LinkedIn-style warmup curve — email doesn't
      // need a connection-request ramp. 30 lands past every cap-step.
      warmup_day: 30,
    },
    { onConflict: 'organisation_id,channel_type,account_identifier' },
  );
}
