import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/partners/export?org_id=<uuid>
 *
 * Returns the organisation's prospects as JSON. The client (ExportButton)
 * builds the CSV and triggers the download — keep this returning JSON, not
 * a file, or the button's `await res.json()` will throw.
 *
 * Columns are verified against the real partners table. The prior version
 * selected `name`, `contact_phone`, and `email_source` — none of which
 * exist — so the query 500'd and the button silently no-op'd.
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('org_id');

  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: partners, error } = await supabase
    .from('partners')
    .select(
      'id, company_name, contact_name, contact_title, contact_email, contact_linkedin, domain, source, partner_type, network_distance, weighted_score, status, email_status, contact_source, created_at',
    )
    .eq('organisation_id', orgId)
    .eq('screened_out', false)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ partners });
}