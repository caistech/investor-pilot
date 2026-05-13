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

  // Fetch partners + currently-in-flight sequence_steps in parallel so we
  // can flag partners with an active sequence (filter aid: "hide already
  // targeted" needs to catch both completed sends AND in-flight rows).
  const [{ data: partners }, { data: activeSteps }, { data: product }] = await Promise.all([
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
      .select('id')
      .eq('organisation_id', profile.organisation_id)
      .limit(1)
      .single(),
  ]);

  const inFlightPartnerIds = new Set(
    (activeSteps || [])
      .map((s: { partner_id: string | null }) => s.partner_id)
      .filter((id): id is string => !!id),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1>Prospects</h1>
          <p className="text-dark-400 mt-1">{partners?.length || 0} prospects in pipeline</p>
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
