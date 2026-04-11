import { authenticateAndGetDb } from '@/lib/agent/db';
import { markOutreachReplied, getOverdueFollowUps } from '@/lib/db/outreach';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/track
 * Manual check for reply status updates and overdue follow-ups.
 * Returns current outreach status for all sent emails.
 *
 * Gmail MCP reply polling can be added later. For now, the founder
 * manually marks replies via the PATCH endpoint below.
 */
export async function GET(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const organisationId = searchParams.get('organisation_id');

  if (!organisationId) {
    return NextResponse.json({ error: 'organisation_id required' }, { status: 400 });
  }

  // Get all outreach entries
  const { data: outreach } = await db
    .from('outreach_log')
    .select(`
      id, partner_id, email_type, to_email, subject, status,
      sent_at, reply_received_at, follow_up_due_at,
      partners!inner(company_name, domain, status)
    `)
    .eq('organisation_id', organisationId)
    .order('sent_at', { ascending: false });

  // Get overdue follow-ups
  const overdue = await getOverdueFollowUps(db, organisationId);

  return NextResponse.json({
    total: outreach?.length || 0,
    sent: outreach?.filter(o => o.status === 'sent').length || 0,
    replied: outreach?.filter(o => o.status === 'replied').length || 0,
    follow_ups_due: overdue.length,
    outreach: outreach || [],
    overdue_follow_ups: overdue,
  });
}

/**
 * PATCH /api/pipeline/track
 * Manually update outreach status (e.g., mark as replied).
 */
export async function PATCH(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { outreach_id, status, partner_id } = await request.json() as {
    outreach_id: string;
    status: 'replied' | 'bounced';
    partner_id: string;
  };

  if (!outreach_id || !status) {
    return NextResponse.json({ error: 'outreach_id and status required' }, { status: 400 });
  }

  if (status === 'replied') {
    const result = await markOutreachReplied(db, outreach_id, partner_id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ status: 'replied', outreach_id });
  }

  if (status === 'bounced') {
    await db.from('outreach_log').update({
      status: 'bounced',
      updated_at: new Date().toISOString(),
    }).eq('id', outreach_id);

    return NextResponse.json({ status: 'bounced', outreach_id });
  }

  return NextResponse.json({ error: 'Invalid status. Use replied or bounced.' }, { status: 400 });
}
