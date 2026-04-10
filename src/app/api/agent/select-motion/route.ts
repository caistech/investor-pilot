import { authenticateAndGetDb } from '@/lib/agent/db';
import { runSelectMotionStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, partners } = await request.json();

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const result = await runSelectMotionStage(product, partners);

  if (result.success && result.data.motions) {
    const { data: profile } = await db
      .from('profiles')
      .select('organisation_id')
      .eq('id', user!.id)
      .single();

    const motions = result.data.motions as Array<Record<string, unknown>>;
    for (const motion of motions) {
      const { data: existing } = await db
        .from('partners')
        .select('id')
        .eq('organisation_id', profile?.organisation_id)
        .eq('domain', motion.domain)
        .single();

      if (existing) {
        await db.from('partners').update({
          partnership_motion: motion.partnership_motion as string,
          selected_gtm_angle: motion.selected_gtm_angle as string,
          status: 'angle_defined',
          last_updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      }
    }

    await db
      .from('agent_sessions')
      .update({ current_stage: 'select_motion' })
      .eq('id', session_id);
  } else {
    await db
      .from('agent_sessions')
      .update({ current_stage: result.success ? 'select_motion' : 'find_contact' })
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
