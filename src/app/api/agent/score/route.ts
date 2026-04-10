import { authenticateAndGetDb } from '@/lib/agent/db';
import { runScoringStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, candidates } = await request.json();

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const result = await runScoringStage(product, candidates);

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  if (result.success && result.data.scored_partners) {
    const scored = result.data.scored_partners as Array<Record<string, unknown>>;
    for (const partner of scored) {
      const candidate = candidates.find(
        (c: { domain: string }) => c.domain === partner.domain
      );

      const { data: existing } = await db
        .from('partners')
        .select('id')
        .eq('organisation_id', profile?.organisation_id)
        .eq('domain', partner.domain)
        .single();

      const partnerData = {
        organisation_id: profile?.organisation_id,
        product_id,
        company_name: partner.company_name,
        domain: partner.domain,
        category: candidate?.category || null,
        status: 'scored',
        weighted_score: partner.weighted_score,
        confidence_score: partner.confidence_score,
        audience_overlap_score: partner.audience_overlap_score,
        audience_overlap_notes: partner.audience_overlap_notes,
        complementarity_score: partner.complementarity_score,
        complementarity_notes: partner.complementarity_notes,
        partner_readiness_score: partner.partner_readiness_score,
        partner_readiness_notes: partner.partner_readiness_notes,
        reachability_score: partner.reachability_score,
        reachability_notes: partner.reachability_notes,
        strategic_leverage_score: partner.strategic_leverage_score,
        strategic_leverage_notes: partner.strategic_leverage_notes,
        last_updated_at: new Date().toISOString(),
      };

      if (existing) {
        await db.from('partners').update(partnerData).eq('id', existing.id);
      } else {
        await db.from('partners').insert(partnerData);
      }
    }

    await db
      .from('agent_sessions')
      .update({ current_stage: 'score', partners_added: scored.length })
      .eq('id', session_id);
  } else {
    await db
      .from('agent_sessions')
      .update({ current_stage: result.success ? 'score' : 'screen' })
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
