import type { SupabaseClient } from '@supabase/supabase-js';

export interface PartnerUpsertData {
  organisation_id: string;
  product_id?: string | null;
  project_id?: string | null;
  company_name: string;
  domain: string;
  category?: string;
  partner_type?: string;
  status?: string;
  weighted_score?: number;
  confidence_score?: string;
  audience_overlap_score?: number;
  audience_overlap_notes?: string;
  complementarity_score?: number;
  complementarity_notes?: string;
  partner_readiness_score?: number;
  partner_readiness_notes?: string;
  reachability_score?: number;
  reachability_notes?: string;
  strategic_leverage_score?: number;
  strategic_leverage_notes?: string;
  screened_out?: boolean;
  screened_out_reason?: string;
  // Pre-populated by LinkedIn / Sales Navigator search — Brave doesn't fill these.
  contact_name?: string;
  contact_title?: string;
  contact_linkedin?: string;
  // Tier-prioritised discovery: '1st' = direct LinkedIn connection (warm DM
  // template, no connect step). '2nd' = mutual connection. 'cold' = no path.
  network_distance?: '1st' | '2nd' | 'cold';
  // Which discovery engine surfaced this row. Persists 'source' from the
  // candidate so the Prospects view can filter LinkedIn vs Brave and so
  // sequence routing can pick the right template without inference.
  source?: 'linkedin' | 'sales_nav' | 'brave' | 'manual';
  // The discovery_runs row that first surfaced this partner. Set on
  // INSERT only — re-discoveries in later runs preserve the origin.
  // See migration 010.
  first_seen_in_run_id?: string | null;
}

export interface ContactData {
  contact_name?: string;
  contact_title?: string;
  contact_email?: string;
  contact_linkedin?: string;
  email_confidence?: number;
  email_status?: string;
  contact_source?: string;
  partnership_motion?: string;
  selected_gtm_angle?: string;
}

export interface DraftData {
  draft_subject: string;
  draft_body: string;
  partnership_motion?: string;
  selected_gtm_angle?: string;
}

/**
 * Compute weighted score from 5 dimension scores.
 * Lender ICP (v3, 2026-05-13) — per Senior Debt Brief v3 Section 4.
 * Schema field names retained from v2; semantics rewritten for lender channel.
 * See docs/sprint-0/09-f2k-best-fit-profile-DRAFT.md.
 */
export function computeWeightedScore(scores: {
  audience_overlap: number;   // Capital available + ticket fit (25%)
  complementarity: number;    // Asset class focus: AU property dev debt (25%)
  partner_readiness: number;  // Decision authority + cadence (15%)
  reachability: number;       // Reachability + geographic concentration (10%)
  strategic_leverage: number; // Track record: lent into AU property dev debt past 36mo (25%) — strongest predictor
}): number {
  return +(
    scores.audience_overlap * 0.25 +
    scores.complementarity * 0.25 +
    scores.strategic_leverage * 0.25 +
    scores.partner_readiness * 0.15 +
    scores.reachability * 0.10
  ).toFixed(2);
}

/**
 * Upsert a partner by domain within an organisation.
 * Returns { status: 'created' | 'updated' | 'error', partner_id?, error? }
 *
 * first_seen_in_run_id is set on INSERT only. On UPDATE we strip it from the
 * payload so the partner's origin run survives re-discovery in later runs.
 */
export async function upsertPartner(
  db: SupabaseClient,
  data: PartnerUpsertData
): Promise<{ status: string; partner_id?: string; error?: string }> {
  const { data: existing } = await db
    .from('partners')
    .select('id')
    .eq('organisation_id', data.organisation_id)
    .eq('domain', data.domain)
    .single();

  if (existing) {
    // Strip first_seen_in_run_id on UPDATE — re-discovery must not overwrite
    // the partner's origin run. Origin is set once at INSERT.
    const { first_seen_in_run_id, ...rest } = data;
    void first_seen_in_run_id;
    const row = { ...rest, last_updated_at: new Date().toISOString() };
    const { error } = await db.from('partners').update(row).eq('id', existing.id);
    if (error) return { status: 'error', error: error.message };
    return { status: 'updated', partner_id: existing.id };
  } else {
    const row = { ...data, last_updated_at: new Date().toISOString() };
    const { data: inserted, error } = await db.from('partners').insert(row).select('id').single();
    if (error) return { status: 'error', error: error.message };
    return { status: 'created', partner_id: inserted?.id };
  }
}

/**
 * Update contact info for a partner (by domain).
 * Only overwrites if new confidence >= existing confidence.
 */
export async function updateContact(
  db: SupabaseClient,
  organisationId: string,
  domain: string,
  contact: ContactData
): Promise<{ status: string; partner_id?: string; error?: string }> {
  const { data: partner } = await db
    .from('partners')
    .select('id, email_confidence')
    .eq('organisation_id', organisationId)
    .eq('domain', domain)
    .single();

  if (!partner) return { status: 'error', error: `Partner not found: ${domain}` };

  const newConf = contact.email_confidence || 0;
  const existingConf = partner.email_confidence || 0;

  if (newConf < existingConf) {
    return { status: 'skipped', partner_id: partner.id };
  }

  const updateData: Record<string, unknown> = {
    last_updated_at: new Date().toISOString(),
  };
  if (contact.contact_name) updateData.contact_name = contact.contact_name;
  if (contact.contact_title) updateData.contact_title = contact.contact_title;
  if (contact.contact_email) updateData.contact_email = contact.contact_email;
  if (contact.contact_linkedin) updateData.contact_linkedin = contact.contact_linkedin;
  if (contact.email_confidence != null) updateData.email_confidence = contact.email_confidence;
  if (contact.email_status) updateData.email_status = contact.email_status;
  if (contact.contact_source) updateData.contact_source = contact.contact_source;
  if (contact.partnership_motion) updateData.partnership_motion = contact.partnership_motion;
  if (contact.selected_gtm_angle) updateData.selected_gtm_angle = contact.selected_gtm_angle;

  updateData.status = contact.contact_email ? 'contact_found' : 'contact_partial';

  const { error } = await db.from('partners').update(updateData).eq('id', partner.id);
  if (error) return { status: 'error', error: error.message };
  return { status: 'updated', partner_id: partner.id };
}

/**
 * Save a draft for a partner (by domain).
 */
export async function saveDraft(
  db: SupabaseClient,
  organisationId: string,
  domain: string,
  draft: DraftData
): Promise<{ status: string; partner_id?: string; error?: string }> {
  const { data: partner } = await db
    .from('partners')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('domain', domain)
    .single();

  if (!partner) return { status: 'error', error: `Partner not found: ${domain}` };

  const { error } = await db.from('partners').update({
    draft_subject: draft.draft_subject,
    draft_body: draft.draft_body,
    draft_status: 'created',
    status: 'draft_ready',
    partnership_motion: draft.partnership_motion || null,
    selected_gtm_angle: draft.selected_gtm_angle || null,
    last_updated_at: new Date().toISOString(),
  }).eq('id', partner.id);

  if (error) return { status: 'error', error: error.message };
  return { status: 'draft_saved', partner_id: partner.id };
}
