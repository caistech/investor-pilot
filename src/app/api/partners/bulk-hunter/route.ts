/**
 * POST /api/partners/bulk-hunter
 *
 * Run Hunter.io domain search against the selected partners' domains and
 * attach the best-confidence verified contact. Used by the "Find emails"
 * bulk action on /prospects — operator selects rows (typically filtered
 * to Contact='Company only'), clicks Find emails, and this route runs
 * the same logic that scoreAndUpsertCandidate now applies inline for new
 * Brave hits, but RETROACTIVELY for existing rows.
 *
 * Body:
 *   { partner_ids: string[] }
 *
 * Per-row outcomes:
 *   - 'enriched': Hunter returned an email; row updated, status moved to
 *     'contact_found' if it was below that previously.
 *   - 'no_emails': Hunter found nothing for the domain.
 *   - 'skipped': row already has a contact_email or no domain to search.
 *   - 'error': individual Hunter call failed.
 *
 * Wall time: 4-wide parallel × ~5s per Hunter call. 60-row selection
 * runs in ~75s — fine for the operator's "click and wait" UX. Server
 * cap of 100 per request keeps a single Vercel invocation safe.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { findContactByDomain } from '@/lib/agent/email-finder';

export const maxDuration = 300;

const CASCADE_CONCURRENCY = 4;
const MAX_PARTNERS_PER_REQUEST = 100;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json().catch(() => ({})) as { partner_ids?: string[] };
  const ids = Array.isArray(body.partner_ids) ? body.partner_ids.filter(id => typeof id === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'partner_ids[] is required' }, { status: 400 });
  }
  if (ids.length > MAX_PARTNERS_PER_REQUEST) {
    return NextResponse.json(
      { error: `max ${MAX_PARTNERS_PER_REQUEST} partners per request — chunk client-side` },
      { status: 400 },
    );
  }

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();
  const orgId = profile?.active_organisation_id as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  // Pull the rows scoped to this org. Only act on rows that have a domain
  // AND don't already have an email. The client gates this too but the
  // server is the source of truth.
  const { data: rows } = await db
    .from('partners')
    .select('id, domain, contact_email, status')
    .eq('organisation_id', orgId)
    .in('id', ids);

  // Eligible = has a real company domain AND no email yet.
  // Skipped:
  //   - linkedin.com/in/<slug> pseudo-domain (contains /)
  //   - linkedin-unknown-<rand> placeholder (set by the runner when LinkedIn
  //     returned no current_company_domain) — Hunter would just waste a
  //     call on a non-resolvable string
  //   - rows already enriched
  const eligible = (rows || []).filter((p) => {
    const d = (p.domain as string | null) || '';
    if (!d) return false;
    if (d.includes('/')) return false;
    if (d.startsWith('linkedin-unknown-')) return false;
    if (p.contact_email) return false;
    return true;
  });

  if (eligible.length === 0) {
    return NextResponse.json({
      ok: true,
      enriched: 0,
      no_emails: 0,
      errors: 0,
      skipped: rows?.length ?? 0,
      message: 'No eligible rows — all selected either had an email already or no domain.',
    });
  }

  const meterFor = { organisation_id: orgId, route: '/api/partners/bulk-hunter' };
  const outcomes: Array<{ partner_id: string; status: string; email?: string | null; error?: string }> = [];

  for (let i = 0; i < eligible.length; i += CASCADE_CONCURRENCY) {
    const slice = eligible.slice(i, i + CASCADE_CONCURRENCY);
    const batch = await Promise.all(
      slice.map(async (p) => {
        try {
          const found = await findContactByDomain(p.domain as string, { meterFor });
          if (!found) {
            return { partner_id: p.id as string, status: 'no_emails', email: null };
          }
          await db.from('partners').update({
            contact_name: found.contact_name,
            contact_title: found.contact_title,
            contact_email: found.contact_email,
            contact_linkedin: found.contact_linkedin,
            email_confidence: found.email_confidence,
            email_status: found.email_confidence >= 70 ? 'verified' : 'probable',
            contact_source: found.source === 'apollo' ? 'apollo_bulk' : 'hunter_bulk',
            status: 'contact_found',
            last_updated_at: new Date().toISOString(),
          }).eq('id', p.id);
          return { partner_id: p.id as string, status: 'enriched', email: found.contact_email };
        } catch (err) {
          return {
            partner_id: p.id as string,
            status: 'error',
            email: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    outcomes.push(...batch);
  }

  await db.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'partners.bulk_hunter',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {
      requested: ids.length,
      eligible: eligible.length,
      enriched: outcomes.filter(o => o.status === 'enriched').length,
      no_emails: outcomes.filter(o => o.status === 'no_emails').length,
      errors: outcomes.filter(o => o.status === 'error').length,
    },
  });

  return NextResponse.json({
    ok: true,
    enriched: outcomes.filter(o => o.status === 'enriched').length,
    no_emails: outcomes.filter(o => o.status === 'no_emails').length,
    errors: outcomes.filter(o => o.status === 'error').length,
    skipped: (rows?.length ?? 0) - eligible.length,
    outcomes,
  });
}
