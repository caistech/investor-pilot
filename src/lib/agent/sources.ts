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
 * Get the primary website / intake URL for a product.
 *
 * Resolution order:
 *   1. The first completed URL-type Knowledge Base source (product_sources
 *      where source_type='url'). This is the original behaviour and stays
 *      first so KB-driven setups are unchanged.
 *   2. Fallback to the product card's own one_pager_url, then pitch_deck_url.
 *      The product edit form presents one_pager_url as "required for
 *      outreach", but it was never wired into this read path — so a URL set
 *      on the card (but not added as a KB source) was invisible to the
 *      draft renderer, which surfaced as "the offering has no intake URL
 *      configured". This fallback makes the card field count.
 *
 * Returns null only when none of those are set.
 */
export async function getProductWebsiteUrl(productId: string): Promise<string | null> {
  const db = createServiceClient();

  // 1) Try completed URL sources first. maybeSingle() (not single()) so that
  //    zero URL sources returns null instead of throwing — the throw was
  //    masking the fallback path below.
  const { data: urlSource } = await db
    .from('product_sources')
    .select('url, title')
    .eq('product_id', productId)
    .eq('source_type', 'url')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // url field is primary, fall back to title if it looks like a URL
  if (urlSource?.url) return urlSource.url;
  if (urlSource?.title?.startsWith('http')) return urlSource.title;

  // 2) Fall back to the product card's own URL fields. These are what the
  //    edit form writes (one_pager_url is the "required for outreach" field;
  //    pitch_deck_url is the optional heavier-weight alternative).
  const { data: product } = await db
    .from('products')
    .select('one_pager_url, pitch_deck_url')
    .eq('id', productId)
    .maybeSingle();

  if (product?.one_pager_url) return product.one_pager_url;
  if (product?.pitch_deck_url) return product.pitch_deck_url;

  return null;
}