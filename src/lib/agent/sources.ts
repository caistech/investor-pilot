import { createClient } from '@/lib/supabase/server';

/**
 * Fetch all completed source content for a product, concatenated.
 * Used to inject knowledge base context into pipeline stages.
 * Caps total at ~15000 chars to stay within token limits.
 */
export async function getProductSourceContent(productId: string): Promise<string> {
  const supabase = createClient();

  const { data: sources } = await supabase
    .from('product_sources')
    .select('title, source_type, content')
    .eq('product_id', productId)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: true });

  if (!sources || sources.length === 0) return '';

  let total = 0;
  const MAX_TOTAL = 15000;
  const chunks: string[] = [];

  for (const source of sources) {
    if (!source.content) continue;
    const header = `--- ${source.source_type.toUpperCase()}: ${source.title} ---`;
    const remaining = MAX_TOTAL - total;
    if (remaining <= 0) break;

    const content = source.content.slice(0, remaining);
    chunks.push(`${header}\n${content}`);
    total += header.length + content.length + 1;
  }

  return chunks.join('\n\n');
}
