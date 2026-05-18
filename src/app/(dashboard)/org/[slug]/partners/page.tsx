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
  const { data: profile } = await supabase.from('profiles').select('organisation_id').single();

  if (!profile?.organisation_id) return <p>Loading...</p>;

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
      .eq('organisation_id', profile.organisation_id)
      .eq('screened_out', false)
      .order('weighted_score', { ascending: false, nullsFirst: false }),
    supabase
      .from('sequence_steps')
      .select('partner_id')
      .eq('organisation_id', profile.organisation_id)
      .in('status', IN_FLIGHT_STATUSES),
    supabase
      .from('products')
      .select('id, name')
      .eq('organisation_id', profile.organisation_id)
      .order('created_at', { ascending: true }),
    supabase
      .from('projects')
      .select('id, name')
      .eq('organisation_id', profile.organisation_id)
      .order('created_at', { ascending: true }),
    supabase
      .from('discovery_runs')
      .select('id, run_code, created_at')
      .eq('organisation_id', profile.organisation_id)
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

      {partners && partners.length > 0 ? (
        <PipelineTable
          partners={partners as Partner[]}
          organisationId={profile.organisation_id}
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
