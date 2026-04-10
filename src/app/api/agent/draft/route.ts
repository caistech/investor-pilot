import { authenticateAndGetDb } from '@/lib/agent/db';
import { runDraftStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';
import type { Partner } from '@/lib/types';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, partner_id } = await request.json();

  if (!partner_id) {
    return NextResponse.json({ error: 'partner_id is required' }, { status: 400 });
  }

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const { data: partnerData } = await db.from('partners').select('*').eq('id', partner_id).single();
  if (!partnerData) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

  const p = partnerData as Partner;
  const events = [];

  // Outreach hygiene checks
  if (['draft_ready', 'sent', 'replied', 'meeting_booked', 'active_partner_discussion'].includes(p.status)) {
    const skipEvent = {
      partner_id: p.id,
      event_type: 'draft_skipped',
      event_data: { company_name: p.company_name, reason: `Already at status: ${p.status}` },
    };
    await db.from('session_events').insert({ session_id, ...skipEvent });
    return NextResponse.json({ success: true, stage: 'draft', data: { skipped: true }, events: [skipEvent] });
  }

  if (!p.contact_email || (p.email_confidence && p.email_confidence < 70)) {
    const skipEvent = {
      partner_id: p.id,
      event_type: 'draft_skipped',
      event_data: { company_name: p.company_name, reason: `Email missing or low confidence (${p.email_confidence || 0}%)` },
    };
    await db.from('session_events').insert({ session_id, ...skipEvent });
    return NextResponse.json({ success: true, stage: 'draft', data: { skipped: true }, events: [skipEvent] });
  }

  // Gather evidence for this partner
  const { data: evidenceEvents } = await db
    .from('session_events')
    .select('event_data')
    .eq('session_id', session_id)
    .in('event_type', ['company_researched', 'partner_scored']);

  const evidence = (evidenceEvents || [])
    .map((e) => {
      const d = e.event_data as Record<string, unknown>;
      return d.company_name === p.company_name ? JSON.stringify(d) : null;
    })
    .filter(Boolean) as string[];

  const result = await runDraftStage(product, p, evidence);

  if (result.success && result.data.draft) {
    const draft = result.data.draft as { subject: string; body: string };
    const { error: updateError } = await db.from('partners').update({
      draft_subject: draft.subject,
      draft_body: draft.body,
      draft_status: 'created',
      status: 'draft_ready',
      last_updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    if (updateError) {
      events.push({
        partner_id: p.id,
        event_type: 'stage_error',
        event_data: { stage: 'draft', error: `DB update failed: ${updateError.message}` },
      });
    } else {
      events.push(...result.events);
    }
  } else {
    events.push(...result.events);
  }

  // Log events
  if (events.length > 0) {
    await db.from('session_events').insert(
      events.map((event) => ({ session_id, ...event }))
    );
  }

  // Update session
  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  const { count: draftCount } = await db
    .from('partners')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', profile?.organisation_id)
    .eq('product_id', product_id)
    .eq('draft_status', 'created');

  await db
    .from('agent_sessions')
    .update({ current_stage: 'draft', drafts_filed: draftCount ?? 0 })
    .eq('id', session_id);

  return NextResponse.json({
    success: true,
    stage: 'draft',
    data: { draft: result.data.draft, partner_id: p.id, company_name: p.company_name },
    events,
  });
}
