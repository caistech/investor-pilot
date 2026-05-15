/**
 * Evidence-enrichment orchestrator.
 *
 * Single entry point for sequence-assign-time enrichment. Dispatches by
 * partner.source:
 *
 *   - 'linkedin' / 'sales_nav' → LinkedIn deep-read
 *   - 'brave'                  → Brave firm-enrichment
 *   - anything else            → no-op (manual rows, legacy data)
 *
 * Idempotent — checks evidence_enriched_at and skips already-enriched
 * partners. Caller (assign-batch) should run this once per partner before
 * creating sequence_steps; the renderer will pick up the new columns
 * automatically through RenderPartner.
 *
 * Per CLAUDE.md REVENUE-tier rules: errors degrade silently. Never block
 * a sequence assignment because enrichment failed — the renderer falls
 * back to existing scoring notes when profile_recent_posts is null.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichPartnerFromLinkedIn, type EnrichmentResult } from './linkedin-profile';
import { enrichPartnerFromBrave } from './brave-firm';

export interface OrchestratorPartner {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  source: 'linkedin' | 'sales_nav' | 'brave' | 'manual' | null;
  network_distance: '1st' | '2nd' | 'cold' | null;
  evidence_enriched_at: string | null;
}

export interface OrchestratorOutcome extends EnrichmentResult {
  partner_id: string;
  partner_name: string;
  source_used: 'linkedin' | 'brave' | 'skipped';
}

export async function enrichPartner(
  db: SupabaseClient,
  partner: OrchestratorPartner,
  linkedinAccountId: string | null,
  options?: { profileOnly?: boolean },
): Promise<OrchestratorOutcome> {
  // Skip if already enriched — UNLESS we're in profileOnly mode and the row
  // hasn't completed full enrichment yet. (profileOnly leaves
  // evidence_enriched_at NULL specifically so the assign-batch pass can
  // come back and add posts; if both fields are set, we're truly done.)
  if (partner.evidence_enriched_at) {
    return {
      partner_id: partner.id,
      partner_name: partner.company_name,
      source_used: 'skipped',
      status: 'success',
      message: 'Already enriched',
      profile_fetched: false,
      posts_fetched_count: 0,
      email_backfilled: false,
    };
  }

  const source = partner.source;

  if ((source === 'linkedin' || source === 'sales_nav') && linkedinAccountId) {
    const result = await enrichPartnerFromLinkedIn(db, partner, linkedinAccountId, options);
    return {
      partner_id: partner.id,
      partner_name: partner.company_name,
      source_used: 'linkedin',
      ...result,
    };
  }

  if (source === 'brave') {
    const result = await enrichPartnerFromBrave(db, partner);
    return {
      partner_id: partner.id,
      partner_name: partner.company_name,
      source_used: 'brave',
      ...result,
    };
  }

  // Manual or unknown source — mark as unavailable so we don't keep retrying.
  await db.from('partners').update({
    evidence_enriched_at: new Date().toISOString(),
    evidence_enrichment_status: 'unavailable',
  }).eq('id', partner.id);

  return {
    partner_id: partner.id,
    partner_name: partner.company_name,
    source_used: 'skipped',
    status: 'unavailable',
    message: `No enrichment path for source = "${source || 'null'}"`,
    profile_fetched: false,
    posts_fetched_count: 0,
    email_backfilled: false,
  };
}

/**
 * Run enrichment for a batch of partners with bounded concurrency.
 * Wraps the orchestrator with a 4-wide semaphore so we don't fan out to
 * 100 simultaneous Unipile calls (which would risk LinkedIn flagging the
 * account for "browsing too many profiles too fast").
 */
export async function enrichPartnersBatch(
  db: SupabaseClient,
  partners: OrchestratorPartner[],
  linkedinAccountId: string | null,
  concurrency = 4,
  options?: { profileOnly?: boolean },
): Promise<OrchestratorOutcome[]> {
  const results: OrchestratorOutcome[] = [];
  for (let i = 0; i < partners.length; i += concurrency) {
    const slice = partners.slice(i, i + concurrency);
    const batch = await Promise.all(
      slice.map(p => enrichPartner(db, p, linkedinAccountId, options)),
    );
    results.push(...batch);
  }
  return results;
}
