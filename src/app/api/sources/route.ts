import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { fetchPageContent } from '@/lib/scrape/fetch-page';

/**
 * Route URL ingestion through the shared Firecrawl-aware fetcher so KB
 * URLs are scraped with JS rendering when FIRECRAWL_API_KEY is set.
 * Without rendering, SPA marketing sites (LingoPure, most React sites)
 * return empty shells and the downstream auto-fill hallucinates.
 */
async function extractTextFromUrl(url: string): Promise<{ title: string; content: string }> {
  const result = await fetchPageContent(url);
  if (!result.ok) {
    throw new Error(result.error);
  }
  // Try to pull a title from the markdown's first heading, or fall back
  // to the hostname (Firecrawl strips the <title> when returning markdown).
  const firstHeading = result.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = firstHeading || new URL(url).hostname;
  return { title, content: result.content.slice(0, 50000) };
}

async function extractTextFromFile(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    // Was `pdf-parse@2.x` but that pulls pdfjs-dist under the hood which
    // references DOMMatrix (a browser API). On Vercel's serverless Node
    // runtime that throws "DOMMatrix is not defined" before we get any
    // text out. unpdf is purpose-built for serverless — zero browser deps,
    // returns the same string-of-text shape we needed.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n\n') : text;
    return merged.slice(0, 50000);
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value.slice(0, 50000);
  }

  if (mimeType.startsWith('text/') || fileName.endsWith('.txt') || fileName.endsWith('.csv') || fileName.endsWith('.md') || fileName.endsWith('.json')) {
    return buffer.toString('utf-8').slice(0, 50000);
  }

  throw new Error(`Unsupported file type: ${mimeType || fileName}`);
}

function getAuthAndDb() {
  const auth = createClient();
  const db = createServiceClient();
  return { auth, db };
}

export async function GET(request: Request) {
  const { auth, db } = getAuthAndDb();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('product_id');
  const projectId = searchParams.get('project_id');
  if (!productId && !projectId) {
    return NextResponse.json({ error: 'product_id or project_id required' }, { status: 400 });
  }

  let q = db
    .from('product_sources')
    .select('id, source_type, title, url, file_name, file_type, file_size, processing_status, error_message, created_at')
    .order('created_at', { ascending: false });
  q = projectId ? q.eq('project_id', projectId) : q.eq('product_id', productId!);

  const { data, error } = await q;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const { auth, db } = getAuthAndDb();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await db.from('profiles').select('organisation_id').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const productId = formData.get('product_id') as string | null;
    const projectId = formData.get('project_id') as string | null;

    if (!file || (!productId && !projectId)) {
      return NextResponse.json({ error: 'file and (product_id or project_id) required' }, { status: 400 });
    }

    const parentLink = projectId ? { project_id: projectId } : { product_id: productId! };

    const { data: source, error: insertError } = await db.from('product_sources').insert({
      ...parentLink, organisation_id: profile.organisation_id,
      source_type: 'file', title: file.name, file_name: file.name,
      file_type: file.type, file_size: file.size, processing_status: 'processing',
    }).select().single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const content = await extractTextFromFile(buffer, file.name, file.type);
      await db.from('product_sources').update({ content, processing_status: 'completed' }).eq('id', source.id);
      return NextResponse.json({ ...source, processing_status: 'completed', content_length: content.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Extraction failed';
      await db.from('product_sources').update({ processing_status: 'failed', error_message: msg }).eq('id', source.id);
      return NextResponse.json({ ...source, processing_status: 'failed', error_message: msg }, { status: 422 });
    }
  }

  const body = await request.json();
  const { product_id, project_id, source_type, title, url, content } = body;
  if (!product_id && !project_id) {
    return NextResponse.json({ error: 'product_id or project_id required' }, { status: 400 });
  }

  const parentLink = project_id ? { project_id } : { product_id };

  if (source_type === 'url') {
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

    const { data: source, error: insertError } = await db.from('product_sources').insert({
      ...parentLink, organisation_id: profile.organisation_id,
      source_type: 'url', title: title || url, url, processing_status: 'processing',
    }).select().single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    try {
      const extracted = await extractTextFromUrl(url);
      await db.from('product_sources').update({
        title: title || extracted.title, content: extracted.content, processing_status: 'completed',
      }).eq('id', source.id);
      return NextResponse.json({ ...source, title: title || extracted.title, processing_status: 'completed', content_length: extracted.content.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scraping failed';
      await db.from('product_sources').update({ processing_status: 'failed', error_message: msg }).eq('id', source.id);
      return NextResponse.json({ ...source, processing_status: 'failed', error_message: msg }, { status: 422 });
    }
  }

  if (source_type === 'text') {
    if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
    const { data: source, error: insertError } = await db.from('product_sources').insert({
      ...parentLink, organisation_id: profile.organisation_id,
      source_type: 'text', title: title || 'Pasted text',
      content: content.slice(0, 50000), processing_status: 'completed',
    }).select().single();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    return NextResponse.json(source, { status: 201 });
  }

  return NextResponse.json({ error: 'Invalid source_type' }, { status: 400 });
}

export async function DELETE(request: Request) {
  const { auth, db } = getAuthAndDb();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await db.from('product_sources').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
