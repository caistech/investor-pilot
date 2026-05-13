/**
 * GET /api/test/unipile-ping[?q=keywords]
 *
 * Diagnostic probe. Runs ONE classic LinkedIn people search via the org's
 * active LinkedIn channel with simple hardcoded keywords (or operator-supplied
 * via ?q=). Returns raw Unipile response shape, count, and any error.
 *
 * Purpose: isolate Unipile plumbing from the full discover-batch flow. If
 * this returns results, Unipile + account_id + wrapper shape all work and
 * the batch issue is downstream. If this fails, we know where to focus.
 *
 * Fast (~5s). No query generation, no scoring, no upsert.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { searchLinkedInPeople } from '@/lib/channels/unipile';

export const maxDuration = 30;

export async function GET(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const url = new URL(request.url);
  const keywords = url.searchParams.get('q') || 'private credit Sydney Australian property';
  const tierParam = url.searchParams.get('tier'); // '1' / '2' / 'cold' / omit

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

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
    });
  }

  const filters: { keywords: string; limit: number; network_distance?: number[] } = {
    keywords,
    limit: 5,
  };
  if (tierParam === '1') filters.network_distance = [1];
  else if (tierParam === '2') filters.network_distance = [2];
  // tier=cold or omitted → no network_distance filter, all degrees

  const started = Date.now();
  const result = await searchLinkedInPeople({
    account_id: channel.oauth_token_ref,
    filters,
  });
  const latency_ms = Date.now() - started;

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      stage: 'unipile_search',
      keywords,
      tier: tierParam || 'all_degrees',
      latency_ms,
      channel: {
        id: channel.id,
        identifier: channel.account_identifier,
        unipile_account_id: channel.oauth_token_ref,
      },
      error: result.error,
      rate_limit_signal: result.rate_limit_signal,
    });
  }

  return NextResponse.json({
    ok: true,
    keywords,
    tier: tierParam || 'all_degrees',
    latency_ms,
    channel: {
      id: channel.id,
      identifier: channel.account_identifier,
      unipile_account_id: channel.oauth_token_ref,
    },
    total: result.total,
    next_cursor: result.next_cursor,
    people_count: result.people.length,
    people_sample: result.people.slice(0, 3).map(p => ({
      name: p.full_name,
      headline: p.headline,
      current_company: p.current_company,
      location: p.location,
      profile_url: p.profile_url,
    })),
  });
}
