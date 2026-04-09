import { authenticateAndGetDb } from '@/lib/agent/db';
import { runDraftStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';
import type { Partner } from '@/lib/types';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, partner_id } = await request.json();

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  // If a specific partner_id is provided, draft for that one partner
  // Otherwise, draft for all partners at 'angle_defined' or 'contact_found' status
  let partners: Partner[];

  if (partner_id) {
    const { data } = await db.from('partners').select('*').eq('id', partner_id).single();
    partners = data ? [data as Partner] : [];
  } else {
    const { data } = await db
      .from('partners')
      .select('*')
      .eq('organisation_id', profile?.organisation_id)
      .eq('product_id', product_id)
      .in('status', ['angle_defined', 'contact_found', 'contact_partial', 'scored'])
      .order('weighted_score', { ascending: false });
    partners = (data || []) as Partner[];
  }

  if (partners.length === 0) {
    return NextResponse.json({
      success: true,
      stage: 'draft',
      data: { drafts: [], message: 'No partners ready for drafting' },
      events: [{
        partner_id: null,
        event_type: 'draft_skipped',
        event_data: { reason: 'No partners at eligible status for drafting' },
      }],
    });
  }

  const drafts = [];
  const allEvents = [];
  let draftsCreated = 0;

  for (const p of partners) {
    // Outreach hygiene checks
    if (['draft_ready', 'sent', 'replied', 'meeting_booked', 'active_partner_discussion'].includes(p.status)) {
      allEvents.push({
        partner_id: p.id,
        event_type: 'draft_skipped',
        event_data: { company_name: p.company_name, reason: `Already at status: ${p.status}` },
      });
      continue;
    }

    if (!p.contact_email || (p.email_confidence && p.email_confidence < 70)) {
      allEvents.push({
        partner_id: p.id,
        event_type: 'draft_skipped',
        event_data: {
          company_name: p.company_name,
          reason: `Email missing or low confidence (${p.email_confidence || 0}%)`,
        },
      });
      continue;
    }

    // Gather evidence
    const { data: events } = await db
      .from('session_events')
      .select('event_data')
      .eq('session_id', session_id)
      .in('event_type', ['company_researched', 'partner_scored']);

    const evidence = (events || [])
      .map((e) => {
        const d = e.event_data as Record<string, unknown>;
        if (d.company_name === p.company_name) return JSON.stringify(d);
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
      }).eq('id', p.id);

      drafts.push({ partner_id: p.id, company_name: p.company_name, ...draft });
      draftsCreated++;
    }

    allEvents.push(...result.events);
  }

  // Log all events
  for (const event of allEvents) {
    await db.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  // Update session
  await db
    .from('agent_sessions')
    .update({ current_stage: 'draft', drafts_filed: draftsCreated })
    .eq('id', session_id);

  return NextResponse.json({
    success: true,
    stage: 'draft',
    data: { drafts, count: draftsCreated },
    events: allEvents,
  });
}
