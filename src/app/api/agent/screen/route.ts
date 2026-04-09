import { authenticateAndGetDb } from '@/lib/agent/db';
import { runScreenStage } from '@/lib/agent/pipeline';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, product_id, candidates } = await request.json();

  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const result = await runScreenStage(product, candidates);

  for (const event of result.events) {
    await db.from('session_events').insert({
      session_id,
      partner_id: event.partner_id,
      event_type: event.event_type,
      event_data: event.event_data,
    });
  }

  await db
    .from('agent_sessions')
    .update({ current_stage: result.success ? 'screen' : 'search' })
    .eq('id', session_id);

  return NextResponse.json(result);
}
