import { authenticateAndGetDb } from '@/lib/agent/db';
import { createOutreachEntry, markOutreachSent } from '@/lib/db/outreach';
import { NextResponse } from 'next/server';

/**
 * POST /api/pipeline/send
 * Creates a Gmail draft for a partner's outreach email.
 * The founder then sends it manually from Gmail.
 *
 * For now, this just records the outreach in outreach_log
 * and marks the partner as 'sent'. Gmail MCP integration
 * for creating drafts can be added later.
 */
export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { partner_id, organisation_id } = await request.json() as {
    partner_id: string;
    organisation_id: string;
  };

  if (!partner_id || !organisation_id) {
    return NextResponse.json({ error: 'partner_id and organisation_id required' }, { status: 400 });
  }

  // Load partner with draft
  const { data: partner } = await db
    .from('partners')
    .select('id, company_name, domain, contact_email, draft_subject, draft_body')
    .eq('id', partner_id)
    .eq('organisation_id', organisation_id)
    .single();

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  }

  if (!partner.contact_email) {
    return NextResponse.json({ error: 'No contact email for this partner' }, { status: 400 });
  }

  if (!partner.draft_subject || !partner.draft_body) {
    return NextResponse.json({ error: 'No draft exists for this partner' }, { status: 400 });
  }

  // Check if already sent
  const { data: existing } = await db
    .from('outreach_log')
    .select('id, status')
    .eq('partner_id', partner_id)
    .eq('email_type', 'first_touch')
    .single();

  if (existing && existing.status === 'sent') {
    return NextResponse.json({ error: 'Already sent to this partner', outreach_id: existing.id }, { status: 409 });
  }

  // Create outreach log entry
  const outreachResult = await createOutreachEntry(db, {
    organisation_id,
    partner_id,
    email_type: 'first_touch',
    to_email: partner.contact_email,
    subject: partner.draft_subject,
    body: partner.draft_body,
  });

  if (outreachResult.error) {
    return NextResponse.json({ error: `Failed to create outreach entry: ${outreachResult.error}` }, { status: 500 });
  }

  // Mark as sent (in production, this would happen after Gmail MCP confirms draft creation)
  const sentResult = await markOutreachSent(db, outreachResult.id!, {});

  if (sentResult.error) {
    return NextResponse.json({ error: `Failed to mark as sent: ${sentResult.error}` }, { status: 500 });
  }

  // Update partner status
  await db.from('partners').update({
    status: 'sent',
    last_updated_at: new Date().toISOString(),
  }).eq('id', partner_id);

  return NextResponse.json({
    status: 'sent',
    outreach_id: outreachResult.id,
    to: partner.contact_email,
    subject: partner.draft_subject,
    company: partner.company_name,
  });
}
