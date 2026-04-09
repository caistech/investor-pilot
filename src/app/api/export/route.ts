import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('organisation_id').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'xlsx';

  const { data: partners } = await supabase
    .from('partners')
    .select('*')
    .eq('organisation_id', profile.organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  if (!partners) return NextResponse.json({ error: 'No data' }, { status: 404 });

  const rows = partners.map((p) => ({
    company_name: p.company_name,
    domain: p.domain,
    partner_type: p.partner_type,
    category: p.category,
    status: p.status,
    weighted_score: p.weighted_score,
    confidence_score: p.confidence_score,
    audience_overlap_notes: p.audience_overlap_notes,
    complementarity_notes: p.complementarity_notes,
    partner_readiness_notes: p.partner_readiness_notes,
    reachability_notes: p.reachability_notes,
    contact_name: p.contact_name,
    contact_title: p.contact_title,
    contact_email: p.contact_email,
    email_confidence: p.email_confidence,
    contact_source: p.contact_source,
    selected_gtm_angle: p.selected_gtm_angle,
    partnership_motion: p.partnership_motion,
    draft_status: p.draft_status,
    hunter_lead_id: p.hunter_lead_id,
    hunter_sending_status: p.hunter_sending_status,
    last_updated_at: p.last_updated_at,
  }));

  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=partners.csv',
      },
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Partners');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=partners.xlsx',
    },
  });
}
