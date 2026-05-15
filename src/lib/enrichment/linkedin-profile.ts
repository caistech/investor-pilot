/**
 * LinkedIn deep-read enrichment for a single partner.
 *
 * Pulls Unipile's /users/{id} (profile) + /users/{id}/posts (last 5 posts)
 * in parallel and writes the result into the partners.profile_* columns
 * (migration 011). Idempotent — caller is responsible for checking
 * partners.evidence_enriched_at IS NULL before invoking.
 *
 * Shape contract validated by the spike route in commits d3f9291 /
 * 4d686de / ce99e40. Three depth tiers observed:
 *   - 1st-degree: profile + email + connected_at + shared_count + posts
 *   - 2nd-degree: profile + shared_count + posts
 *   - 3rd-degree / cold: profile + posts (often empty)
 *
 * Returns a discriminated union; caller decides whether to set
 * evidence_enrichment_status to 'success', 'partial', 'failed', or
 * 'unavailable' based on the result.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractLinkedInProviderId,
  getLinkedInProfile,
  getLinkedInPosts,
  type LinkedInPost,
} from '@/lib/channels/unipile';

export interface EnrichmentResult {
  status: 'success' | 'partial' | 'failed' | 'unavailable';
  message?: string;
  // Detail counts for audit logging.
  profile_fetched: boolean;
  posts_fetched_count: number;
  email_backfilled: boolean;
}

export async function enrichPartnerFromLinkedIn(
  db: SupabaseClient,
  partner: {
    id: string;
    contact_linkedin: string | null;
    contact_email: string | null;
    network_distance: '1st' | '2nd' | 'cold' | null;
  },
  accountId: string,
): Promise<EnrichmentResult> {
  if (!partner.contact_linkedin) {
    await db.from('partners').update({
      evidence_enriched_at: new Date().toISOString(),
      evidence_enrichment_status: 'unavailable',
      evidence_enrichment_source: 'linkedin',
    }).eq('id', partner.id);
    return {
      status: 'unavailable',
      message: 'No contact_linkedin on partner',
      profile_fetched: false,
      posts_fetched_count: 0,
      email_backfilled: false,
    };
  }

  const providerId = extractLinkedInProviderId(partner.contact_linkedin);
  if (!providerId) {
    await db.from('partners').update({
      evidence_enriched_at: new Date().toISOString(),
      evidence_enrichment_status: 'unavailable',
      evidence_enrichment_source: 'linkedin',
    }).eq('id', partner.id);
    return {
      status: 'unavailable',
      message: 'Could not extract provider_id from contact_linkedin',
      profile_fetched: false,
      posts_fetched_count: 0,
      email_backfilled: false,
    };
  }

  // Profile + posts in parallel — independent endpoints, ~1-2s each.
  const [profileResult, postsResult] = await Promise.all([
    getLinkedInProfile({ account_id: accountId, provider_id: providerId }),
    getLinkedInPosts({ account_id: accountId, provider_id: providerId, limit: 5 }),
  ]);

  // If both failed, treat as failed. If one succeeded, partial. Both succeed = success.
  const profileOk = profileResult.ok;
  const postsOk = postsResult.ok;

  if (!profileOk && !postsOk) {
    await db.from('partners').update({
      evidence_enriched_at: new Date().toISOString(),
      evidence_enrichment_status: 'failed',
      evidence_enrichment_source: 'linkedin',
    }).eq('id', partner.id);
    return {
      status: 'failed',
      message: `Both endpoints failed: profile=${!profileOk ? profileResult.error : 'ok'}, posts=${!postsOk ? postsResult.error : 'ok'}`,
      profile_fetched: false,
      posts_fetched_count: 0,
      email_backfilled: false,
    };
  }

  // Build the column payload from whatever succeeded.
  const payload: Record<string, unknown> = {
    evidence_enriched_at: new Date().toISOString(),
    evidence_enrichment_source: 'linkedin',
    evidence_enrichment_status: (profileOk && postsOk) ? 'success' : 'partial',
  };

  let emailBackfilled = false;

  if (profileOk) {
    const p = profileResult.profile;
    payload.profile_email = p.email;
    payload.profile_connected_at = p.connected_at?.toISOString() || null;
    payload.profile_shared_connections_count = p.shared_connections_count;
    payload.profile_follower_count = p.follower_count;
    payload.profile_engagement_flags = {
      is_premium: p.is_premium,
      is_creator: p.is_creator,
      is_influencer: p.is_influencer,
      is_open_profile: p.is_open_profile,
    };

    // Auto-backfill contact_email for 1st-degree connections that don't have
    // one yet. Unipile only returns the email for connections (is_relationship
    // = true), so this never overwrites externally-acquired emails for non-
    // connections. Saves a Hunter.io call for the warm-DM path.
    if (p.email && !partner.contact_email && p.is_relationship) {
      payload.contact_email = p.email;
      payload.email_status = 'verified';   // Unipile only surfaces verified contact emails
      payload.email_confidence = 100;
      payload.contact_source = 'unipile_profile';
      emailBackfilled = true;
    }
  }

  let postsCount = 0;
  if (postsOk) {
    const filtered = filterPostsForPersonalization(postsResult.posts);
    postsCount = filtered.length;
    payload.profile_recent_posts = filtered.map(p => ({
      text: p.text.slice(0, 1500),
      parsed_datetime: p.parsed_datetime?.toISOString() || null,
      is_repost: p.is_repost,
      author_name: p.author_name,
      share_url: p.share_url,
      reaction_counter: p.reaction_counter,
      repost_content_text: p.repost_content_text?.slice(0, 1500) || null,
    }));
  }

  await db.from('partners').update(payload).eq('id', partner.id);

  return {
    status: payload.evidence_enrichment_status as 'success' | 'partial',
    profile_fetched: profileOk,
    posts_fetched_count: postsCount,
    email_backfilled: emailBackfilled,
  };
}

/**
 * Trim and prioritise posts for personalization. Drop posts older than 18
 * months (relevance ages fast on LinkedIn) and posts under 40 chars (likely
 * just emojis or short reactions, no signal). Sort by parsed_datetime desc
 * so most-recent leads.
 *
 * Caps at 5 — anything more is overkill for a one-line opener prompt.
 */
function filterPostsForPersonalization(posts: LinkedInPost[]): LinkedInPost[] {
  const eighteenMonthsAgo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
  return posts
    .filter(p => {
      const t = p.parsed_datetime?.getTime() ?? 0;
      if (t < eighteenMonthsAgo) return false;
      const effectiveText = p.text || p.repost_content_text || '';
      return effectiveText.trim().length >= 40;
    })
    .sort((a, b) => (b.parsed_datetime?.getTime() ?? 0) - (a.parsed_datetime?.getTime() ?? 0))
    .slice(0, 5);
}
