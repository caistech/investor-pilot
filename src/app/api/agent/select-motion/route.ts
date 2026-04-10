import { authenticateAndGetDb } from '@/lib/agent/db';
import { runSelectMotionForPartner } from '@/lib/agent/pipeline';
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

  const result = await runSelectMotionForPartner(product, partner);

  if (result.success && result.data.motion) {
    const { data: profile } = await db
      .from('profiles')
      .select('organisation_id')
      .eq('id', user!.id)
      .single();

    const motion = result.data.motion as Record<string, unknown>;

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

  // Do NOT update session stage — client handles that after all partners complete

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
