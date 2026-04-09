import { createClient } from '@/lib/supabase/server';
import { runSelectMotionStage } from '@/lib/agent/pipeline';
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

  const result = await runSelectMotionStage(product, partners);

  // Update partner records with motion and GTM angle
  if (result.success && result.data.motions) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organisation_id')
      .eq('id', user.id)
      .single();

    const motions = result.data.motions as Array<Record<string, unknown>>;
    for (const motion of motions) {
      const { data: existing } = await supabase
        .from('partners')
        .select('id')
        .eq('organisation_id', profile?.organisation_id)
        .eq('domain', motion.domain)
        .single();

      if (existing) {
        await supabase.from('partners').update({
          partnership_motion: motion.partnership_motion as string,
          selected_gtm_angle: motion.selected_gtm_angle as string,
          status: 'angle_defined',
          last_updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      }
    }

    await supabase
      .from('agent_sessions')
      .update({ current_stage: 'select_motion' })
      .eq('id', session_id);
  } else {
    await supabase
      .from('agent_sessions')
      .update({ current_stage: result.success ? 'select_motion' : 'find_contact' })
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
