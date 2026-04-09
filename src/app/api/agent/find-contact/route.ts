import { createClient } from '@/lib/supabase/server';
import { runFindContactStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { session_id, product_id, partners } = await request.json();

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const result = await runFindContactStage(product, partners);

  // Update partner records with contact info
  if (result.success && result.data.contacts) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organisation_id')
      .eq('id', user.id)
      .single();

    const contacts = result.data.contacts as Array<Record<string, unknown>>;
    let contactsFound = 0;

    for (const contact of contacts) {
      const { data: existing } = await supabase
        .from('partners')
        .select('id, email_confidence')
        .eq('organisation_id', profile?.organisation_id)
        .eq('domain', contact.domain)
        .single();

      if (existing) {
        // Only update if new confidence is higher
        const newConfidence = (contact.email_confidence as number) || 0;
        const existingConfidence = existing.email_confidence || 0;

        if (newConfidence >= existingConfidence) {
          await supabase.from('partners').update({
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

          if (contact.contact_email) contactsFound++;
        }
      }
    }

    await supabase
      .from('agent_sessions')
      .update({ current_stage: 'find_contact', contacts_found: contactsFound })
      .eq('id', session_id);
  } else {
    await supabase
      .from('agent_sessions')
      .update({ current_stage: result.success ? 'find_contact' : 'browse' })
      .eq('id', session_id);
  }

  for (const event of result.events) {
    await supabase.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  return NextResponse.json(result);
}
