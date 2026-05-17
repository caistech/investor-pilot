import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { fetchPageContent } from '@/lib/scrape/fetch-page';
import { claudeClient, claudeModel } from '@/lib/llm/client';

export const maxDuration = 60;

// Empty-extraction threshold. If text extraction (unpdf for PDF, mammoth
// for DOCX) returns fewer characters than this, we fall back to Claude
// vision — the source is almost certainly image-only (designed infographic,
// scanned doc, slide deck without text layer). Threshold tuned high enough
// to catch image-only PDFs that may have small amounts of metadata text
// (page numbers, copyright) but low enough not to trigger on legitimately
// short text docs.
const VISION_FALLBACK_THRESHOLD = 500;

/**
 * Vision fallback: send the raw file directly to Claude as a document or
 * image content block, ask it to produce a structured text summary of the
 * substantive content, return that as the source's "extracted text". The
 * downstream auto-fill / rubric / sequence generators consume the
 * `content` field opaquely — they don't know (or need to know) whether
 * it came from unpdf or from Claude vision.
 *
 * Cost: ~$0.02-0.05 per page on Sonnet 4.5 (vision token rates apply).
 * For a typical 1-page investor one-pager that's trivial; for a 30-page
 * IM it's ~$0.50-1.50, still cheap relative to the operator's time.
 *
 * Used for:
 *   - PDFs where unpdf returned <500 chars (image-only PDFs)
 *   - DOCX where mammoth returned <500 chars (image-only Word docs)
 *   - Image uploads (PNG, JPG, WEBP) — straight to vision, no extraction first
 */
async function extractViaVision(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const base64 = buffer.toString('base64');
  const isImage = mimeType.startsWith('image/');

  // Anthropic's content-block shape for documents (PDFs) vs images.
  // Image MIME types must be jpeg/png/gif/webp; PDFs use application/pdf
  // and use a `document` block (vision is automatic inside the doc block).
  const visionMediaType = isImage
    ? (mimeType === 'image/jpg' ? 'image/jpeg' : mimeType) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    : null;

  const block = isImage
    ? {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: visionMediaType!, data: base64 },
      }
    : {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
      };

  const response = await claudeClient.messages.create(
    {
      model: claudeModel,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            block,
            {
              type: 'text' as const,
              text: `Extract a structured text summary of this ${isImage ? 'image' : 'document'} (${fileName}). The downstream pipeline ingests this as Knowledge Base content for an investor outreach platform — quote concrete numbers (funding sizes, valuations, traction stats, geography), name specific entities (sponsors, partners, customers, founders), preserve structure (headings, lists, deal terms). Do NOT add interpretation or commentary. Output only the substantive content as plain text, no markdown decoration, no "I see..." preamble.`,
            },
          ],
        },
      ],
    },
    { signal: AbortSignal.timeout(55_000) },
  );

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  return text.trim().slice(0, 50000);
}

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
    const trimmed = merged.trim();

    // Vision fallback: image-only PDFs (designed infographics, slide
    // decks, scans) leave the text layer empty. unpdf returns whitespace
    // or page-number fragments. Re-read via Claude vision so the operator
    // doesn't have to manually paste text. Phase 1 of the unified-KB-
    // ingestion principle (see memory).
    if (trimmed.length < VISION_FALLBACK_THRESHOLD) {
      try {
        return await extractViaVision(buffer, 'application/pdf', fileName);
      } catch (err) {
        // Vision fallback failed — surface the original extraction
        // (likely empty) with a hint so the operator knows why this
        // source contributes nothing to auto-fill.
        const visionErr = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Text extraction returned only ${trimmed.length} characters AND vision fallback failed: ${visionErr}. This PDF appears to be image-only — try the Paste Text option with the document's content typed/pasted directly.`,
        );
      }
    }

    return merged.slice(0, 50000);
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const trimmed = result.value.trim();

    // Same vision fallback for DOCX — operators occasionally upload
    // Word docs that are mostly images / charts (term sheets exported
    // from design tools, slide-deck-style memos). mammoth gracefully
    // returns near-empty in those cases.
    if (trimmed.length < VISION_FALLBACK_THRESHOLD) {
      try {
        // Anthropic's document block doesn't accept DOCX directly — but
        // we can describe via image? Actually no — DOCX with image-only
        // content is rare AND Anthropic doesn't accept DOCX in the
        // document block. Surface the issue plainly so the operator
        // converts to PDF or pastes text.
        throw new Error('docx-vision-not-supported');
      } catch {
        throw new Error(
          `Text extraction from DOCX returned only ${trimmed.length} characters — likely an image-heavy Word doc. Export to PDF (File → Save as PDF) and re-upload, or use the Paste Text option.`,
        );
      }
    }

    return result.value.slice(0, 50000);
  }

  // Image upload — straight to Claude vision, no extraction step. Phase 2
  // capability so operators can drop in pitch-deck screenshots, scans of
  // term sheets, or individual slides without going via PDF first.
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg' || mimeType === 'image/webp' || mimeType === 'image/gif'
    || /\.(png|jpe?g|webp|gif)$/i.test(fileName)) {
    return await extractViaVision(buffer, mimeType, fileName);
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
