/**
 * PATCH /api/settings/icp
 *
 * Updates the Phase C scoring/ICP fields on a product row: scoring_rubric,
 * icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases.
 * These flow into buildScoringPrompt() at request time so any change here
 * affects the next discovery batch.
 *
 * Body shape:
 *   {
 *     product_id: string,
 *     scoring_rubric?: string | null,
 *     icp_categories?: string[] | null,
 *     icp_partner_type?: string | null,
 *     icp_reject_categories?: string[] | null,
 *     icp_special_cases?: string[] | null,
 *   }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';

interface PatchBody {
  product_id?: string;
  scoring_rubric?: string | null;
  icp_categories?: string[] | null;
  icp_partner_type?: string | null;
  icp_reject_categories?: string[] | null;
  icp_special_cases?: string[] | null;
}

export async function PATCH(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  if (!body.product_id) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 });
  }

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (!profile?.organisation_id) {
    return NextResponse.json({ error: 'No organisation linked to user' }, { status: 400 });
  }

  const { data: existing } = await db
    .from('products')
    .select('id')
    .eq('id', body.product_id)
    .eq('organisation_id', profile.organisation_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Product not found in your organisation' }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.scoring_rubric !== undefined) update.scoring_rubric = body.scoring_rubric;
  if (body.icp_categories !== undefined) update.icp_categories = body.icp_categories;
  if (body.icp_partner_type !== undefined) update.icp_partner_type = body.icp_partner_type;
  if (body.icp_reject_categories !== undefined) update.icp_reject_categories = body.icp_reject_categories;
  if (body.icp_special_cases !== undefined) update.icp_special_cases = body.icp_special_cases;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateErr } = await db
    .from('products')
    .update(update)
    .eq('id', body.product_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
