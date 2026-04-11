import { createServiceClient } from '@/lib/supabase/server';

/**
 * Fetch all completed source content for a product, concatenated.
 * Used to inject knowledge base context into pipeline stages.
 * Caps total at ~15000 chars to stay within token limits.
 */
export async function getProductSourceContent(productId: string): Promise<string> {
  const db = createServiceClient();

  const { data: sources } = await db
    .from('product_sources')
    .select('title, source_type, url, content')
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

/**
 * Get the primary website URL for a product from its sources.
 * Returns the first URL-type source's url field.
 */
export async function getProductWebsiteUrl(productId: string): Promise<string | null> {
  const db = createServiceClient();

  // Try completed URL sources first
  const { data } = await db
    .from('product_sources')
    .select('url, title')
    .eq('product_id', productId)
    .eq('source_type', 'url')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  // url field is primary, fall back to title if it looks like a URL
  if (data?.url) return data.url;
  if (data?.title?.startsWith('http')) return data.title;
  return null;
}
