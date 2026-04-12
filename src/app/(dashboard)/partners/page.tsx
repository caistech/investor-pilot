import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import type { Partner } from '@/lib/types';
import { PipelineTable } from '@/components/partners/pipeline-table';

export default async function PartnersPage() {
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('organisation_id').single();

  if (!profile?.organisation_id) return <p>Loading...</p>;

  const { data: partners } = await supabase
    .from('partners')
    .select('*')
    .eq('organisation_id', profile.organisation_id)
    .eq('screened_out', false)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  // Get the first product for this org (used for draft generation context)
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('organisation_id', profile.organisation_id)
    .limit(1)
    .single();

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
