import { createClient } from '@/lib/supabase/server';
import { runSearchStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { session_id, product_id, categories } = await request.json();

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const result = await runSearchStage(product, categories);

  for (const event of result.events) {
    await supabase.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  await supabase
    .from('agent_sessions')
    .update({ current_stage: result.success ? 'search' : 'categories' })
    .eq('id', session_id);

  return NextResponse.json(result);
}
