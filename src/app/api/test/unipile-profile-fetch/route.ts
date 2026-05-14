/**
 * GET /api/test/unipile-profile-fetch
 *
 * Spike route for Option 1 (LinkedIn deep-read enrichment). Calls Unipile's
 * profile-fetch endpoint directly via fetch (no wrapper) so we can discover
 * the exact response shape before writing typed code against it.
 *
 * Inputs (precedence top-to-bottom — first match wins):
 *   ?provider_id=<LinkedIn URN tail or public_id>
 *   ?partner_id=<uuid in this org's partners table — looks up contact_linkedin
 *                and extracts the provider_id from it>
 *   ?find=1st|2nd|cold — auto-picks the most recent LinkedIn-sourced partner
 *                in this org at that network tier and probes it. Lets us
 *                check whether Unipile's profile/posts endpoints behave
 *                differently across tiers without manually hunting uuids.
 *
 * Returns:
 *   - HTTP status from Unipile
 *   - Latency
 *   - Shape report: presence + sizes of the fields we plan to consume
 *     (about/summary, headline, experience, recent posts/activity, skills,
 *     education, connections_count)
 *   - Top-level keys list (so we see fields we didn't expect)
 *   - Truncated raw payload (first ~6KB) for spot-inspection
 *
 * Once the shape is confirmed, this route's findings inform the typed
 * getLinkedInProfile() wrapper in src/lib/channels/unipile.ts. Delete this
 * route after the wrapper ships.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { extractLinkedInProviderId } from '@/lib/channels/unipile';

export const maxDuration = 30;

const UNIPILE_BASE_URL = process.env.UNIPILE_BASE_URL || 'https://api.unipile.com';
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || '';

export async function GET(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  if (!UNIPILE_API_KEY) {
    return NextResponse.json({ ok: false, stage: 'env', error: 'UNIPILE_API_KEY not set' }, { status: 500 });
  }
  if (!process.env.UNIPILE_BASE_URL) {
    return NextResponse.json({ ok: false, stage: 'env', error: 'UNIPILE_BASE_URL not set' }, { status: 500 });
  }

  const url = new URL(request.url);
  const partnerIdParam = url.searchParams.get('partner_id');
  const findParam = url.searchParams.get('find'); // '1st' | '2nd' | 'cold'
  let providerId = url.searchParams.get('provider_id');

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ ok: false, stage: 'profile', error: 'No organisation linked to user' }, { status: 400 });
  }

  // Resolve provider_id from partner_id OR find=<tier> when not given directly.
  // Precedence: provider_id > partner_id > find.
  let resolvedFromPartner: { partner_id: string; company_name: string | null; network_distance: string | null; contact_linkedin: string | null } | null = null;

  if (!providerId && partnerIdParam) {
    const { data: partner } = await db
      .from('partners')
      .select('id, company_name, network_distance, contact_linkedin')
      .eq('id', partnerIdParam)
      .eq('organisation_id', profile.organisation_id)
      .maybeSingle();
    if (!partner) {
      return NextResponse.json({ ok: false, stage: 'partner_lookup', error: 'Partner not found in your org' }, { status: 404 });
    }
    resolvedFromPartner = {
      partner_id: partner.id as string,
      company_name: (partner.company_name as string) || null,
      network_distance: (partner.network_distance as string) || null,
      contact_linkedin: (partner.contact_linkedin as string) || null,
    };
    if (!partner.contact_linkedin) {
      return NextResponse.json({
        ok: false,
        stage: 'partner_resolve',
        error: 'Partner has no contact_linkedin — Brave-sourced rows lack a LinkedIn URL',
        resolved: resolvedFromPartner,
      }, { status: 400 });
    }
    providerId = extractLinkedInProviderId(partner.contact_linkedin as string);
    if (!providerId) {
      return NextResponse.json({
        ok: false,
        stage: 'partner_resolve',
        error: `Could not extract provider_id from contact_linkedin: ${(partner.contact_linkedin as string).slice(0, 120)}`,
        resolved: resolvedFromPartner,
      }, { status: 400 });
    }
  } else if (!providerId && findParam) {
    if (!['1st', '2nd', 'cold'].includes(findParam)) {
      return NextResponse.json({
        ok: false,
        stage: 'input',
        error: `find must be one of: 1st, 2nd, cold (got "${findParam}")`,
      }, { status: 400 });
    }
    // Pick the most recent LinkedIn-sourced partner at this tier with a usable
    // contact_linkedin. Brave-sourced rows have no LinkedIn URL by definition,
    // so we constrain to source = linkedin OR sales_nav.
    const { data: partner } = await db
      .from('partners')
      .select('id, company_name, network_distance, contact_linkedin, source, last_updated_at')
      .eq('organisation_id', profile.organisation_id)
      .eq('network_distance', findParam)
      .in('source', ['linkedin', 'sales_nav'])
      .not('contact_linkedin', 'is', null)
      .order('last_updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!partner) {
      return NextResponse.json({
        ok: false,
        stage: 'find',
        error: `No LinkedIn-sourced partner found at tier "${findParam}" with a contact_linkedin in your org`,
      }, { status: 404 });
    }
    resolvedFromPartner = {
      partner_id: partner.id as string,
      company_name: (partner.company_name as string) || null,
      network_distance: (partner.network_distance as string) || null,
      contact_linkedin: (partner.contact_linkedin as string) || null,
    };
    providerId = extractLinkedInProviderId(partner.contact_linkedin as string);
    if (!providerId) {
      return NextResponse.json({
        ok: false,
        stage: 'find',
        error: `Auto-picked partner has unparsable contact_linkedin: ${(partner.contact_linkedin as string).slice(0, 120)}`,
        resolved: resolvedFromPartner,
      }, { status: 400 });
    }
  }

  if (!providerId) {
    return NextResponse.json({
      ok: false,
      stage: 'input',
      error: 'Pass one of: ?provider_id=<id>, ?partner_id=<uuid>, ?find=1st|2nd|cold',
    }, { status: 400 });
  }

  // Active LinkedIn channel — provides the account_id (Unipile DSN account ref).
  const { data: channel } = await db
    .from('client_channels')
    .select('id, oauth_token_ref, account_identifier, status')
    .eq('organisation_id', profile.organisation_id)
    .eq('channel_type', 'linkedin')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!channel?.oauth_token_ref) {
    return NextResponse.json({
      ok: false,
      stage: 'channel_lookup',
      error: 'No active LinkedIn channel found for this org',
    }, { status: 400 });
  }

  // Per Unipile docs (developer.unipile.com/docs/users-retrieve), the profile
  // fetch is: GET /api/v1/users/{identifier}?account_id=...
  // The identifier accepts public_id or URN; the account_id query param tells
  // Unipile which connected account to act as.
  const unipileUrl = new URL(`${UNIPILE_BASE_URL}/api/v1/users/${encodeURIComponent(providerId)}`);
  unipileUrl.searchParams.set('account_id', channel.oauth_token_ref as string);

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(unipileUrl.toString(), {
      method: 'GET',
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        accept: 'application/json',
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      stage: 'fetch',
      url_called: unipileUrl.toString().replace(UNIPILE_API_KEY, '***'),
      error: `Network/fetch error: ${detail}`,
    }, { status: 502 });
  }
  const latency_ms = Date.now() - started;

  const text = await response.text();

  if (!response.ok) {
    return NextResponse.json({
      ok: false,
      stage: 'unipile_response',
      http_status: response.status,
      latency_ms,
      provider_id_used: providerId,
      resolved_from_partner: resolvedFromPartner,
      channel: {
        id: channel.id,
        identifier: channel.account_identifier,
        unipile_account_id: channel.oauth_token_ref,
      },
      error: `Unipile ${response.status}: ${text.slice(0, 1500)}`,
    });
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({
      ok: false,
      stage: 'parse',
      http_status: response.status,
      latency_ms,
      provider_id_used: providerId,
      raw_excerpt: text.slice(0, 1500),
      error: 'Unipile returned non-JSON',
    });
  }

  // Shape report — names match Unipile's documented fields where known, plus
  // common alternate names we've seen in other endpoints' payloads. The goal
  // is to surface what's actually present so the typed wrapper can normalise.
  const shape = {
    top_level_keys: parsed ? Object.keys(parsed).sort() : [],
    has_about: hasNonEmpty(parsed, ['about', 'summary', 'description']),
    about_length: pickFirstStringLength(parsed, ['about', 'summary', 'description']),
    has_headline: hasNonEmpty(parsed, ['headline', 'title']),
    has_experience: arrayLength(parsed, ['experience', 'experiences', 'work_experience', 'positions']),
    has_education: arrayLength(parsed, ['education', 'educations']),
    has_skills: arrayLength(parsed, ['skills']),
    has_recent_activity: arrayLength(parsed, ['recent_activity', 'recent_posts', 'posts', 'activity', 'shares']),
    has_connections_count: hasNumeric(parsed, ['connections_count', 'follower_count', 'followers', 'connections']),
    has_location: hasNonEmpty(parsed, ['location', 'location_name', 'geographic_area']),
    has_industry: hasNonEmpty(parsed, ['industry']),
    has_current_company: hasNonEmpty(parsed, ['current_company']),
  };

  // Sample-only excerpt of the raw payload so the response is browseable. The
  // first 6KB is enough to eyeball the shape; full inspection should go via
  // server logs if needed.
  const raw_excerpt = text.length > 6000 ? text.slice(0, 6000) + '\n…[truncated]' : text;

  // Second probe — posts/activity endpoint. The basic profile endpoint above
  // returned no about/experience/posts, so the depth signals we need for
  // warm openers ("saw your post on X") must come from a separate endpoint
  // if Unipile exposes one. Trying the documented pattern
  // `GET /users/{id}/posts?account_id=...`. Failure here is informational, not
  // fatal — fall through and report the status so the caller knows whether
  // posts are reachable at all.
  const postsUrl = new URL(`${UNIPILE_BASE_URL}/api/v1/users/${encodeURIComponent(providerId)}/posts`);
  postsUrl.searchParams.set('account_id', channel.oauth_token_ref as string);
  postsUrl.searchParams.set('limit', '5');

  const postsStarted = Date.now();
  let postsResponse: Response | null = null;
  let postsFetchError: string | null = null;
  try {
    postsResponse = await fetch(postsUrl.toString(), {
      method: 'GET',
      headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' },
    });
  } catch (err) {
    postsFetchError = err instanceof Error ? err.message : String(err);
  }
  const postsLatencyMs = Date.now() - postsStarted;

  let postsEndpoint: Record<string, unknown> = {
    url_path: `/api/v1/users/${providerId}/posts`,
    latency_ms: postsLatencyMs,
  };

  if (postsFetchError) {
    postsEndpoint = { ...postsEndpoint, ok: false, stage: 'fetch', error: postsFetchError };
  } else if (postsResponse) {
    const postsText = await postsResponse.text();
    if (!postsResponse.ok) {
      postsEndpoint = {
        ...postsEndpoint,
        ok: false,
        http_status: postsResponse.status,
        error: `Unipile ${postsResponse.status}: ${postsText.slice(0, 800)}`,
      };
    } else {
      let postsParsed: Record<string, unknown> | unknown[] | null = null;
      try {
        postsParsed = JSON.parse(postsText);
      } catch {
        postsEndpoint = {
          ...postsEndpoint,
          ok: false,
          http_status: postsResponse.status,
          stage: 'parse',
          raw_excerpt: postsText.slice(0, 1500),
          error: 'Non-JSON response',
        };
      }
      if (postsParsed) {
        // Posts endpoints in Unipile typically return either an array directly
        // or an object with items/data/results/posts holding the array. Surface
        // whichever it is so we know what to consume.
        const items: unknown[] = Array.isArray(postsParsed)
          ? postsParsed
          : ((postsParsed as Record<string, unknown>).items as unknown[]) ||
            ((postsParsed as Record<string, unknown>).data as unknown[]) ||
            ((postsParsed as Record<string, unknown>).results as unknown[]) ||
            ((postsParsed as Record<string, unknown>).posts as unknown[]) ||
            [];
        const firstPost = items[0] && typeof items[0] === 'object' ? (items[0] as Record<string, unknown>) : null;
        postsEndpoint = {
          ...postsEndpoint,
          ok: true,
          http_status: postsResponse.status,
          envelope_keys: !Array.isArray(postsParsed)
            ? Object.keys(postsParsed as Record<string, unknown>).sort()
            : ['<array root>'],
          item_count: items.length,
          first_post_keys: firstPost ? Object.keys(firstPost).sort() : [],
          first_post_has_text: firstPost
            ? hasNonEmpty(firstPost, ['text', 'body', 'content', 'commentary', 'description'])
            : false,
          first_post_text_length: firstPost
            ? pickFirstStringLength(firstPost, ['text', 'body', 'content', 'commentary', 'description'])
            : 0,
          first_post_has_date: firstPost
            ? hasNonEmpty(firstPost, ['created_at', 'date', 'published_at', 'posted_at', 'timestamp'])
            : false,
          first_post_has_type: firstPost
            ? hasNonEmpty(firstPost, ['type', 'post_type', 'activity_type'])
            : false,
          raw_excerpt: postsText.length > 4000 ? postsText.slice(0, 4000) + '\n…[truncated]' : postsText,
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    http_status: response.status,
    latency_ms,
    provider_id_used: providerId,
    resolved_from_partner: resolvedFromPartner,
    channel: {
      id: channel.id,
      identifier: channel.account_identifier,
      unipile_account_id: channel.oauth_token_ref,
    },
    shape,
    raw_excerpt,
    posts_endpoint: postsEndpoint,
  });
}

function hasNonEmpty(obj: Record<string, unknown> | null, keys: string[]): boolean {
  if (!obj) return false;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return true;
  }
  return false;
}

function pickFirstStringLength(obj: Record<string, unknown> | null, keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v.length;
  }
  return 0;
}

function arrayLength(obj: Record<string, unknown> | null, keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v.length;
  }
  return 0;
}

function hasNumeric(obj: Record<string, unknown> | null, keys: string[]): boolean {
  if (!obj) return false;
  for (const k of keys) {
    if (typeof obj[k] === 'number') return true;
  }
  return false;
}
