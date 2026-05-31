import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const orgId = searchParams.get('org_id');

  if (!orgId) {
    return NextResponse.json({ error: 'organisation_id required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: partners, error } = await supabase
    .from('partners')
    .select('id, name, company_name, contact_email, contact_phone, contact_linkedin, source, weighted_score, status, network_distance, email_source, created_at')
    .eq('organisation_id', orgId)
    .eq('screened_out', false)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ partners });
}
