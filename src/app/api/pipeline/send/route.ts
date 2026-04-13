import { authenticateAndGetDb } from '@/lib/agent/db';
import { createOutreachEntry, markOutreachSent } from '@/lib/db/outreach';
import { sendEmail } from '@/lib/email/resend';
import { NextResponse } from 'next/server';

/**
 * POST /api/pipeline/send
 * Sends an outreach email via Resend and logs it in outreach_log.
 */
export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { partner_id, organisation_id, contact_email: overrideEmail, draft_subject: overrideSubject, draft_body: overrideBody } = await request.json() as {
    partner_id: string;
    organisation_id: string;
    contact_email?: string;
    draft_subject?: string;
    draft_body?: string;
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

  // Use DB fields, falling back to overrides from the UI (session inline drafts have these)
  const finalEmail = partner.contact_email || overrideEmail;
  const finalSubject = partner.draft_subject || overrideSubject;
  const finalBody = partner.draft_body || overrideBody;

  if (!finalEmail) {
    return NextResponse.json({ error: 'No contact email for this partner' }, { status: 400 });
  }

  if (!finalSubject || !finalBody) {
    return NextResponse.json({ error: 'No draft exists for this partner' }, { status: 400 });
  }

  // Backfill the partner record if it was missing contact/draft data
  const backfill: Record<string, unknown> = {};
  if (!partner.contact_email && finalEmail) backfill.contact_email = finalEmail;
  if (!partner.draft_subject && finalSubject) backfill.draft_subject = finalSubject;
  if (!partner.draft_body && finalBody) backfill.draft_body = finalBody;
  if (Object.keys(backfill).length > 0) {
    await db.from('partners').update(backfill).eq('id', partner_id);
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

  // Look up sender's email for reply-to
  const { data: profile } = await db
    .from('profiles')
    .select('email')
    .eq('id', user!.id)
    .single();

  // Send via Resend
  const emailResult = await sendEmail({
    to: finalEmail,
    subject: finalSubject,
    body: finalBody,
    replyTo: profile?.email || undefined,
  });

  if (emailResult.error) {
    return NextResponse.json({ error: `Failed to send email: ${emailResult.error}` }, { status: 500 });
  }

  // Create outreach log entry
  const outreachResult = await createOutreachEntry(db, {
    organisation_id,
    partner_id,
    email_type: 'first_touch',
    to_email: finalEmail,
    subject: finalSubject,
    body: finalBody,
  });

  if (outreachResult.error) {
    return NextResponse.json({ error: `Failed to create outreach entry: ${outreachResult.error}` }, { status: 500 });
  }

  // Mark as sent with Resend message ID
  const sentResult = await markOutreachSent(db, outreachResult.id!, {
    message_id: emailResult.id,
  });

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
    resend_id: emailResult.id,
    to: finalEmail,
    subject: finalSubject,
    company: partner.company_name,
  });
}
