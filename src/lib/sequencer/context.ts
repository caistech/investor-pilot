/**
 * Sequencer per-batch context loaders.
 *
 * Wraps the per-organisation lookups that `renderStep` needs (sender identity
 * for now; product/facility/ICP data in subsequent phases) behind a tiny
 * memoised cache so a single cron / re-render run only hits the DB once per
 * unique organisation, not once per partner.
 *
 * The cache is intentionally request-scoped: callers create a fresh cache at
 * the top of their handler and discard it on return. Cross-request caching
 * would risk serving stale config after an operator updates `/settings`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RenderContext } from './render';

export type OrgContextCache = {
  get(organisationId: string): Promise<RenderContext>;
};

/**
 * Build a request-scoped cache that fetches per-organisation render context
 * on demand. Throws (rather than returning a default) when the organisation
 * row is missing required sender fields — surfaces as a `compliance_blocked`
 * step in the cron loop, prompting the operator to configure `/settings`.
 */
export function createOrgContextCache(db: SupabaseClient): OrgContextCache {
  const memo = new Map<string, RenderContext>();

  return {
    async get(organisationId: string): Promise<RenderContext> {
      const hit = memo.get(organisationId);
      if (hit) return hit;

      const { data: org, error } = await db
        .from('organisations')
        .select('sender_name, sender_role, signature_block, sender_linkedin_url, sender_bio_one_liner, sender_calendar_url')
        .eq('id', organisationId)
        .single();

      if (error) {
        throw new Error(
          `Failed to load organisation ${organisationId} for render context: ${error.message}`,
        );
      }
      if (!org?.sender_name || !org?.sender_role) {
        throw new Error(
          `organisations.${organisationId} missing sender_name or sender_role — configure via /settings`,
        );
      }

      const ctx: RenderContext = {
        sender_name: org.sender_name,
        sender_role: org.sender_role,
        signature_block: org.signature_block ?? null,
        sender_linkedin_url: (org.sender_linkedin_url as string) || null,
        sender_bio_one_liner: (org.sender_bio_one_liner as string) || null,
        sender_calendar_url: (org.sender_calendar_url as string) || null,
      };
      memo.set(organisationId, ctx);
      return ctx;
    },
  };
}
