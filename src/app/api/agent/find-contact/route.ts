import { authenticateAndGetDb } from '@/lib/agent/db';
import { runFindContactForPartner } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, partner } = await request.json();

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const result = await runFindContactForPartner(product, partner);

  if (result.success && result.data.contact) {
    const { data: profile } = await db
      .from('profiles')
      .select('organisation_id')
      .eq('id', user!.id)
      .single();

    const contact = result.data.contact as Record<string, unknown>;

    const { data: existing } = await db
      .from('partners')
      .select('id, email_confidence')
      .eq('organisation_id', profile?.organisation_id)
      .eq('domain', contact.domain)
      .single();

    if (existing) {
      const newConfidence = (contact.email_confidence as number) || 0;
      const existingConfidence = existing.email_confidence || 0;

      if (newConfidence >= existingConfidence) {
        await db.from('partners').update({
          contact_name: contact.contact_name,
          contact_title: contact.contact_title,
          contact_email: contact.contact_email,
          contact_linkedin: contact.contact_linkedin,
          email_confidence: contact.email_confidence,
          email_status: contact.email_status,
          contact_source: contact.contact_source,
          status: contact.contact_email ? 'contact_found' : 'contact_partial',
          last_updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      }
    }
  }

  // Insert events
  for (const event of result.events) {
    await db.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  return NextResponse.json(result);
}
