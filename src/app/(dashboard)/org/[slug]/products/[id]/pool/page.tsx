// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { computePoolSummary, type PoolPartner } from '@/lib/pool/summary';
import { PoolSummaryView } from '@/components/pool/pool-summary-view';

export const dynamic = 'force-dynamic';

export default async function ProductSummaryPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id')
    .single();
  if (!profile?.active_organisation_id) notFound();

  const db = createServiceClient();
  const { data: product } = await db
    .from('products')
    .select('id, name, one_sentence_description, asset_class, geography, partner_types')
    .eq('id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .single();
  if (!product) notFound();

  const { data: partnersRaw } = await db
    .from('partners')
    .select('id, company_name, contact_name, weighted_score, category, status, source, network_distance, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .eq('product_id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  const summary = computePoolSummary((partnersRaw || []) as PoolPartner[], { kind: 'product' });

  const subline = [product.asset_class, product.geography, product.partner_types ? `Partners: ${product.partner_types}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="max-w-5xl mx-auto">
      <div className="print:hidden">
        <Link href="/products" className="flex items-center gap-2 text-dark-400 hover:text-white mb-6 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to products
        </Link>
      </div>

      <PoolSummaryView
        kind="product"
        ownerName={product.name}
        subline={subline}
        summary={summary}
        partnersHref={`/partners?product=${product.id}`}
      />
    </div>
  );
}
