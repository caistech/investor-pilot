// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import type { Partner } from '@/lib/types';
import { PipelineTable } from '@/components/partners/pipeline-table';

// In-flight = sequence_steps row exists for the partner with a non-terminal
// status. Two terminal-success ones (sent, replied) we DON'T treat as
// in-flight because the partner.status already reflects them; the rest
// (pending, queued_for_approval, awaiting_verification, compliance_blocked,
// failed) mean the partner is actively being worked.
const IN_FLIGHT_STATUSES = [
  'pending',
  'awaiting_verification',
  'queued_for_approval',
  'compliance_blocked',
  'failed',
];

export default async function PartnersPage() {
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('active_organisation_id').single();

  if (!profile?.active_organisation_id) return <p>Loading...</p>;

  // Fetch partners + currently-in-flight sequence_steps + discovery_runs +
  // every product / project (for the offering filter) in parallel so we can
  // flag partners with an active sequence ("hide already targeted"),
  // annotate each row with its origin discovery run, and let the operator
  // narrow by Sales (product) vs Funding (project) — and by specific
  // product/project within that.
  const [
    { data: partners },
    { data: activeSteps },
    { data: products },
    { data: projects },
    { data: runs },
  ] = await Promise.all([
    supabase
      .from('partners')
      .select('*')
      .eq('organisation_id', profile.active_organisation_id)
      .eq('screened_out', false)
      .order('weighted_score', { ascending: false, nullsFirst: false }),
    supabase
      .from('sequence_steps')
      .select('partner_id')
      .eq('organisation_id', profile.active_organisation_id)
      .in('status', IN_FLIGHT_STATUSES),
    supabase
      .from('products')
      .select('id, name')
      .eq('organisation_id', profile.active_organisation_id)
      .order('created_at', { ascending: true }),
    supabase
      .from('projects')
      .select('id, name')
      .eq('organisation_id', profile.active_organisation_id)
      .order('created_at', { ascending: true }),
    supabase
      .from('discovery_runs')
      .select('id, run_code, created_at')
      .eq('organisation_id', profile.active_organisation_id)
      .order('created_at', { ascending: false }),
  ]);

  // Legacy single-product prop — first product if any. Kept so existing
  // batchAction('draft') fallback path still works for product-only orgs.
  const product = (products || [])[0] ?? null;

  // Build a lookup so the table can annotate each partner with the run that
  // first surfaced them (partners.first_seen_in_run_id → run_code + date).
  // Legacy partners (pre-migration 010) have null first_seen_in_run_id and
  // render as "—" in the Run column.
  const runsById = new Map(
    (runs || []).map(r => [r.id as string, {
      run_code: r.run_code as string,
      created_at: r.created_at as string,
    }]),
  );
  const runsForFilter = (runs || []).map(r => ({
    id: r.id as string,
    run_code: r.run_code as string,
    created_at: r.created_at as string,
  }));

  const inFlightPartnerIds = new Set(
    (activeSteps || [])
      .map((s: { partner_id: string | null }) => s.partner_id)
      .filter((id): id is string => !!id),
  );

  // Header count matches what the table actually renders. PipelineTable
  // pre-filters rows without a contact_name (Brave-sourced company-only
  // listings and the like — see pipeline-table.tsx line 282). If we report
  // the raw count here, the chip 'Brave (web) 20' or the 'All N' counter
  // disagrees with what's visible, which is what prompted '20 brave but 0
  // shown' confusion 2026-05-19.
  const actionableCount =
    (partners || []).filter(
      (p) => typeof p.contact_name === 'string' && (p.contact_name as string).trim().length > 0,
    ).length;

  // Email-finder performance panel. The cascade routes Brave-sourced rows
  // through Hunter first, then Apollo on a Hunter miss or role-account
  // result. contact_source records which provider actually attached the
  // contact so the operator can see at a glance whether Apollo is
  // earning its credits or just burning them on misses.
  const emailFinderStats = (() => {
    const allPartners = partners || [];
    const hunterSources = new Set(['hunter_at_discovery', 'hunter_domain_search', 'hunter_bulk']);
    const apolloSources = new Set(['apollo_at_discovery', 'apollo_bulk', 'apollo_enrich']);
    let hunter = 0;
    let apollo = 0;
    let other = 0;
    let noEmail = 0;
    for (const p of allPartners) {
      const source = typeof p.contact_source === 'string' ? p.contact_source : '';
      const hasEmail = typeof p.contact_email === 'string' && (p.contact_email as string).trim().length > 0;
      if (!hasEmail) {
        noEmail += 1;
        continue;
      }
      if (hunterSources.has(source)) hunter += 1;
      else if (apolloSources.has(source)) apollo += 1;
      else other += 1;
    }
    const totalWithEmail = hunter + apollo + other;
    return { hunter, apollo, other, noEmail, totalWithEmail };
  })();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1>Prospects</h1>
          <p className="text-dark-400 mt-1">{actionableCount} prospects in pipeline</p>
        </div>
        <Link href="/sessions" className="btn-primary">
          Discover More
        </Link>
      </div>

      {/*
        Email-finder performance — Hunter vs Apollo split, plus the
        no-email tail. Lives above the prospect table so the operator
        sees provider yield at a glance before scanning rows.
      */}
      {(partners?.length ?? 0) > 0 && (
        <div className="card mb-6">
          <div className="text-xs text-dark-400 uppercase tracking-wide mb-2">
            Email finder performance
          </div>
          <div className="flex flex-wrap gap-4 sm:gap-6 items-baseline">
            <div>
              <div className="text-2xl font-semibold">{emailFinderStats.hunter}</div>
              <div className="text-xs text-dark-400">via Hunter</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{emailFinderStats.apollo}</div>
              <div className="text-xs text-dark-400">via Apollo</div>
            </div>
            {emailFinderStats.other > 0 && (
              <div>
                <div className="text-2xl font-semibold">{emailFinderStats.other}</div>
                <div className="text-xs text-dark-400">via other / legacy</div>
              </div>
            )}
            <div>
              <div className="text-2xl font-semibold text-dark-400">{emailFinderStats.noEmail}</div>
              <div className="text-xs text-dark-400">no email yet</div>
            </div>
            <div className="ml-auto text-xs text-dark-400">
              Cascade: Hunter → Apollo (role-account fallthrough). Apollo fires only when Hunter misses or returns admin@/info@.
            </div>
          </div>
        </div>
      )}

      {partners && partners.length > 0 ? (
        <PipelineTable
          partners={partners as Partner[]}
          organisationId={profile.active_organisation_id}
          productId={product?.id || ''}
          inFlightPartnerIds={Array.from(inFlightPartnerIds)}
          runsById={Object.fromEntries(runsById)}
          runsForFilter={runsForFilter}
          offerings={[
            ...(products || []).map((p) => ({ kind: 'product' as const, id: p.id as string, name: p.name as string })),
            ...(projects || []).map((p) => ({ kind: 'project' as const, id: p.id as string, name: p.name as string })),
          ]}
        />
      ) : (
        <div className="card text-center py-16">
          <p className="text-dark-400 text-lg">No prospects discovered yet</p>
          <p className="text-dark-500 mt-2">Start a session to discover and score potential investor prospects.</p>
          <Link href="/sessions" className="btn-primary inline-block mt-4">Start a Session</Link>
        </div>
      )}
    </div>
  );
}
