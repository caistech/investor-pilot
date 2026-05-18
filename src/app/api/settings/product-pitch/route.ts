/**
 * PATCH /api/settings/product-pitch
 *
 * Updates the Phase B fields on a product row: the pitch + facility data
 * that buildDraftPrompt() interpolates into the system prompt for every
 * draft generation. Edits here flow into the next batch of drafts; existing
 * drafts on partners are not retro-edited.
 *
 * Body shape:
 *   {
 *     product_id: string,
 *     product_pitch?: string | null,
 *     facility_summary?: DraftFacility[] | null,
 *     asset_class?: string | null,
 *     geography?: string | null,
 *     ticket_size_min_label?: string | null,
 *     ticket_size_max_label?: string | null,
 *     draft_compliance_forbidden_terms?: string[] | null,
 *   }
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import type { DraftFacility } from '@/lib/pipeline/draft-prompt';

interface PatchBody {
  product_id?: string;
  product_pitch?: string | null;
  facility_summary?: DraftFacility[] | null;
  asset_class?: string | null;
  geography?: string | null;
  ticket_size_min_label?: string | null;
  ticket_size_max_label?: string | null;
  draft_compliance_forbidden_terms?: string[] | null;
}

export async function PATCH(request: Request) {
  const { db, orgId, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  if (!body.product_id) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 });
  }

  if (!orgId) {
    return NextResponse.json({ error: 'No active organisation for this user' }, { status: 400 });
  }

  // Confirm the product belongs to the caller's org before touching it.
  const { data: existing } = await db
    .from('products')
    .select('id')
    .eq('id', body.product_id)
    .eq('organisation_id', orgId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Product not found in your organisation' }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.product_pitch !== undefined) update.product_pitch = body.product_pitch;
  if (body.facility_summary !== undefined) update.facility_summary = body.facility_summary;
  if (body.asset_class !== undefined) update.asset_class = body.asset_class;
  if (body.geography !== undefined) update.geography = body.geography;
  if (body.ticket_size_min_label !== undefined) update.ticket_size_min_label = body.ticket_size_min_label;
  if (body.ticket_size_max_label !== undefined) update.ticket_size_max_label = body.ticket_size_max_label;
  if (body.draft_compliance_forbidden_terms !== undefined) {
    update.draft_compliance_forbidden_terms = body.draft_compliance_forbidden_terms;
  }

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
