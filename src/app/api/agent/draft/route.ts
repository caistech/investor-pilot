import { authenticateAndGetDb } from '@/lib/agent/db';
import { runDraftStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';
import type { Partner } from '@/lib/types';

export async function POST(request: Request) {
  const { db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, partner_id } = await request.json();

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const { data: partner } = await db
    .from('partners')
    .select('*')
    .eq('id', partner_id)
    .single();

  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

  const p = partner as Partner;

  if (['draft_ready', 'sent', 'replied', 'meeting_booked', 'active_partner_discussion'].includes(p.status)) {
    return NextResponse.json({
      error: `Partner is already at status "${p.status}". Cannot create fresh outreach.`,
      status: p.status,
    }, { status: 409 });
  }

  if (!p.contact_email || (p.email_confidence && p.email_confidence < 70)) {
    return NextResponse.json({
      warning: 'Contact email missing or below 70% confidence',
      email: p.contact_email,
      confidence: p.email_confidence,
    }, { status: 422 });
  }

  const { data: events } = await db
    .from('session_events')
    .select('event_data')
    .eq('session_id', session_id)
    .in('event_type', ['company_researched', 'partner_scored']);

  const evidence = (events || [])
    .map((e) => {
      const d = e.event_data as Record<string, unknown>;
      if (d.company_name === p.company_name) {
        return JSON.stringify(d);
      }
      return null;
    })
    .filter(Boolean) as string[];

  const result = await runDraftStage(product, p, evidence);

  if (result.success && result.data.draft) {
    const draft = result.data.draft as { subject: string; body: string };
    await db.from('partners').update({
      draft_subject: draft.subject,
      draft_body: draft.body,
      draft_status: 'created',
      status: 'draft_ready',
      last_updated_at: new Date().toISOString(),
    }).eq('id', partner_id);

    await db
      .from('agent_sessions')
      .update({ current_stage: 'draft', drafts_filed: 1 })
      .eq('id', session_id);
  }

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
