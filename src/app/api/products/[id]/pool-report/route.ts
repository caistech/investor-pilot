/**
 * GET /api/products/[id]/pool-report
 *
 * Auto-generated market-research summary of the partner pool surfaced
 * for a product (sales side). Mirror of /api/projects/[id]/pool-report
 * — same aggregation, same shape, recipient noun is "partner" not
 * "investor" in the narrative insights.
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { computePoolSummary, type PoolPartner, type PoolSummary } from '@/lib/pool/summary';

export const dynamic = 'force-dynamic';

export interface ProductPoolReport extends PoolSummary {
  product_id: string;
  product_name: string;
  generated_at: string;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();
  if (!profile?.active_organisation_id) {
    return NextResponse.json({ error: 'No organisation' }, { status: 400 });
  }

  const { data: product } = await db
    .from('products')
    .select('id, name, organisation_id')
    .eq('id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .single();
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const { data: partnersRaw } = await db
    .from('partners')
    .select('id, company_name, contact_name, weighted_score, category, status, source, network_distance, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .eq('product_id', params.id)
    .eq('organisation_id', profile.active_organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  const summary = computePoolSummary((partnersRaw || []) as PoolPartner[], { kind: 'product' });

  const report: ProductPoolReport = {
    product_id: product.id,
    product_name: product.name,
    generated_at: new Date().toISOString(),
    ...summary,
  };

  return NextResponse.json(report);
}
