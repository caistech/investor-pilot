'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Globe, FileText, Type, Upload, Loader2, Trash2,
  CheckCircle, XCircle, FileUp, Link2, AlertTriangle, Sparkles,
} from 'lucide-react';
import type { ProductSource } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

interface SourceManagerProps {
  productId?: string;
  projectId?: string;
}

// Image MIME types added for Phase 2 — operators upload pitch-deck slides
// as PNG/JPG screenshots, or scans of term sheets. Server routes them
// straight to Claude vision since there's no text layer to extract.
const FILE_ACCEPT = '.pdf,.docx,.doc,.txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp';
// Vercel's serverless function body cap is 4.5MB by default — uploads
// larger than this never reach our route, the platform 413s them at the
// edge. Was 10MB pre-2026-05-17 and operators were hitting silent
// platform failures on standard pitch decks (typically 5-15MB). Capped
// here so the operator sees the limit upfront with a useful suggestion.
// Proper fix (queued — see project_queued_direct_upload memory): switch
// to direct-to-Supabase Storage uploads via signed URLs, which bypass
// the function body limit entirely.
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB — Vercel function body cap

export default function SourceManager({ productId, projectId }: SourceManagerProps) {
  const parentKey = projectId ? 'project_id' : 'product_id';
  const parentValue = projectId || productId || '';
  const autofillRoute = projectId ? '/api/agent/autofill-project' : '/api/agent/autofill-product';
  const [sources, setSources] = useState<ProductSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<'url' | 'file' | 'text' | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textInput, setTextInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const loadSources = useCallback(async () => {
    if (!parentValue) { setLoading(false); return; }
    const res = await fetch(`/api/sources?${parentKey}=${parentValue}`);
    if (res.ok) {
      const data = await res.json();
      setSources(data);
    }
    setLoading(false);
  }, [parentKey, parentValue]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  async function addUrl() {
    if (!urlInput.trim()) return;
    setAdding(true);
    setError(null);

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [parentKey]: parentValue,
          source_type: 'url',
          url: urlInput.startsWith('http') ? urlInput : `https://${urlInput}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error_message || data.error || 'Failed to add URL');
      }
      setUrlInput('');
      setAddMode(null);
      loadSources();
    } catch {
      setError('Failed to add URL');
    }
    setAdding(false);
  }

  async function addText() {
    if (!textInput.trim()) return;
    setAdding(true);
    setError(null);

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [parentKey]: parentValue,
          source_type: 'text',
          title: textTitle || 'Pasted text',
          content: textInput,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to add text');
      }
      setTextInput('');
      setTextTitle('');
      setAddMode(null);
      loadSources();
    } catch {
      setError('Failed to add text');
    }
    setAdding(false);
  }

  /**
   * Single-file uploader — kept as the primitive for the multi-file
   * wrapper below. Throws (rather than swallowing) so the wrapper's
   * Promise.allSettled can isolate per-file failures.
   */
  async function uploadOneFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 4MB platform limit. ` +
        `Options: (1) compress the PDF (free tools like ilovepdf.com / smallpdf typically cut pitch decks in half), ` +
        `(2) split into smaller sections and upload separately, or ` +
        `(3) use Paste Text with the deck's key content.`,
      );
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append(parentKey, parentValue);
    const res = await fetch('/api/sources', { method: 'POST', body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string; error_message?: string }));
      throw new Error(`${file.name}: ${data.error_message || data.error || `HTTP ${res.status}`}`);
    }
  }

  /**
   * Multi-file uploader. Runs uploads in chunks of 3 (concurrency cap so
   * a big drop doesn't fan out to 20 simultaneous Vercel function
   * invocations + burn through browser fetch slots). Per-file failures
   * are collected and surfaced together — operator sees "3 of 7 failed"
   * with specifics rather than "upload failed" with no detail.
   */
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setAdding(true);
    setError(null);
    const errors: string[] = [];
    const concurrency = 3;
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map(uploadOneFile));
      for (const r of results) {
        if (r.status === 'rejected') {
          errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      }
      // Refresh between batches so the operator sees uploaded sources
      // appearing progressively rather than all at once at the end.
      await loadSources();
    }
    if (errors.length > 0) {
      const head = errors.slice(0, 3).join('\n• ');
      const more = errors.length > 3 ? `\n• …${errors.length - 3} more` : '';
      setError(`${errors.length} of ${files.length} files failed:\n• ${head}${more}`);
    }
    setAddMode(null);
    setAdding(false);
  }

  async function deleteSource(id: string) {
    await fetch(`/api/sources?id=${id}`, { method: 'DELETE' });
    loadSources();
  }

  if (!parentValue) {
    return null;
  }

  // Read uploaded sources, ask Claude to rewrite the product's ICP fields
  // using them, then write the result straight back to the products row.
  // This is the docs-first auto-fill: upload PDFs/URLs → click here → ICP
  // fields reflect the actual material rather than a guess from the name.
  async function autofillFromKB() {
    setAutofilling(true);
    setError(null);
    setAutofillStatus('idle');
    try {
      const res = await fetch(autofillRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [parentKey]: parentValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Auto-fill failed');
        setAutofillStatus('error');
        return;
      }

      // Apply the returned profile to the correct table.
      // Both schemas share most ICP fields. Projects additionally have
      // sponsor/project_type/funding_target/geography/asset_class/description.
      const sharedKeys = [
        'name', 'core_mechanism', 'customer_outcomes',
        'icp_company_size', 'icp_stage', 'icp_verticals', 'icp_buyer_title',
        'icp_user_title', 'icp_stack_tools', 'traction_arr', 'traction_customers',
        'partner_types', 'exclusions',
      ] as const;
      const projectOnlyKeys = ['sponsor', 'description', 'project_type', 'funding_target', 'geography', 'asset_class'] as const;
      const productOnlyKeys = ['one_sentence_description'] as const;

      const update: Record<string, unknown> = {};
      for (const k of sharedKeys) {
        if (typeof data[k] === 'string' && data[k].trim()) update[k] = data[k];
      }
      if (projectId) {
        for (const k of projectOnlyKeys) {
          if (typeof data[k] === 'string' && data[k].trim()) update[k] = data[k];
        }
      } else {
        for (const k of productOnlyKeys) {
          if (typeof data[k] === 'string' && data[k].trim()) update[k] = data[k];
        }
      }

      const table = projectId ? 'projects' : 'products';
      const { error: updateError } = await supabase
        .from(table)
        .update(update)
        .eq('id', parentValue);

      if (updateError) {
        setError(updateError.message);
        setAutofillStatus('error');
        return;
      }

      setAutofillStatus('success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-fill failed');
      setAutofillStatus('error');
    } finally {
      setAutofilling(false);
    }
  }

  const completedSources = sources.filter(s => s.processing_status === 'completed').length;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) uploadFiles(files);
    // Reset the input value so selecting the same file again triggers
    // onChange (browsers suppress the event if the value is unchanged).
    e.target.value = '';
  }

  function getSourceIcon(source: ProductSource) {
    if (source.source_type === 'url') return <Globe className="w-4 h-4 text-blue-400" />;
    if (source.source_type === 'file') return <FileUp className="w-4 h-4 text-purple-400" />;
    return <Type className="w-4 h-4 text-amber-400" />;
  }

  function getStatusIcon(status: string) {
    if (status === 'completed') return <CheckCircle className="w-3.5 h-3.5 text-corp-green-500" />;
    if (status === 'processing') return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />;
    if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    return <Loader2 className="w-3.5 h-3.5 text-dark-500" />;
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  // Context-aware hints: products = sales collateral, projects = investment materials.
  // The doc set you want for finding customers is fundamentally different from what you
  // want for pitching investors. Make the prompts reflect that.
  const isProject = !!projectId;
  const kbTitle = isProject ? 'Investment materials' : 'Knowledge Base';
  const kbHint = isProject
    ? 'Upload pitch deck, financials, data room links, term sheets, market memo, cap table, founder bios. The AI quotes concrete numbers from these in the investor outreach.'
    : 'Upload product collateral — one-pagers, demos, case studies, customer testimonials, pricing, technical docs. Better KB = more accurate rubric + outreach copy.';
  const exampleDocLine = isProject
    ? 'Common docs: pitch deck (PDF), financial model (XLSX), data room URL, term sheet, market sizing memo.'
    : 'Common docs: product one-pager, demo video link, case study, customer testimonials, pricing sheet.';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4>{kbTitle}</h4>
          <p className="text-dark-500 text-sm mt-0.5">{kbHint}</p>
          <p className="text-dark-600 text-xs mt-1 italic">{exampleDocLine}</p>
        </div>
        {sources.length > 0 && (
          <span className="badge-blue">{sources.filter((s) => s.processing_status === 'completed').length} sources</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">&times;</button>
        </div>
      )}

      {/* Existing sources */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-dark-500" />
        </div>
      ) : sources.length > 0 ? (
        <div className="space-y-2 mb-4">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center gap-3 px-3 py-2 bg-dark-800 rounded-lg group">
              {getSourceIcon(source)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{source.title}</span>
                  {getStatusIcon(source.processing_status)}
                </div>
                <div className="flex items-center gap-2 text-xs text-dark-500">
                  {source.source_type === 'url' && source.url && (
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-dark-300">
                      <Link2 className="w-3 h-3" /> {new URL(source.url).hostname}
                    </a>
                  )}
                  {source.file_name && <span>{source.file_name}</span>}
                  {source.file_size && <span>{formatSize(source.file_size)}</span>}
                  {source.processing_status === 'failed' && (
                    <span className="text-red-400">{source.error_message}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteSource(source.id)}
                className="opacity-0 group-hover:opacity-100 text-dark-600 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Auto-fill from KB — the docs-first action. Visible whenever sources
          are present so the operator can re-run after each upload. */}
      {completedSources > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-corp-green-500/5 border border-corp-green-500/20">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-corp-green-400">Auto-fill ICP from these sources</p>
              <p className="text-dark-500 text-xs mt-0.5">
                Re-reads the {completedSources} uploaded source{completedSources > 1 ? 's' : ''} and rewrites the product&apos;s ICP fields (description, buyer title, verticals, exclusions, etc.). Run this after uploading PDFs so the AI works from the canonical material, not just the product name.
              </p>
            </div>
            <button
              onClick={autofillFromKB}
              disabled={autofilling}
              className="btn-primary text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-40"
            >
              {autofilling ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Reading sources…</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Auto-fill from KB</>
              )}
            </button>
          </div>
          {autofillStatus === 'success' && (
            <p className="text-corp-green-400 text-xs mt-2 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> ICP fields updated. Reloading…
            </p>
          )}
        </div>
      )}

      {/* Add source buttons */}
      {!addMode && (
        <div className="flex gap-2">
          <button
            onClick={() => setAddMode('url')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" /> Add URL
          </button>
          <button
            onClick={() => setAddMode('file')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg transition-colors"
          >
            <FileUp className="w-3.5 h-3.5 text-purple-400" /> Upload File
          </button>
          <button
            onClick={() => setAddMode('text')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg transition-colors"
          >
            <Type className="w-3.5 h-3.5 text-amber-400" /> Paste Text
          </button>
        </div>
      )}

      {/* URL input */}
      {addMode === 'url' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-dark-500 mb-1">Website URL</label>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
              placeholder="https://yourproduct.com or https://yourproduct.com/about"
              autoFocus
            />
            <p className="text-dark-600 text-xs mt-1">Landing pages, about pages, pricing pages, docs — anything with product info</p>
          </div>
          <div className="flex gap-2">
            <button onClick={addUrl} disabled={adding || !urlInput.trim()} className="btn-primary text-sm py-1.5 px-4 disabled:opacity-40">
              {adding ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Scraping...</> : 'Add URL'}
            </button>
            <button onClick={() => { setAddMode(null); setUrlInput(''); }} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* File upload */}
      {addMode === 'file' && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-corp-green-500 bg-corp-green-500/5'
                : 'border-dark-600 hover:border-dark-500'
            }`}
          >
            {adding ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-corp-green-400" />
                <span className="text-sm text-dark-400">Extracting text...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-dark-500" />
                <span className="text-sm text-dark-300">
                  Drop file(s) here or <span className="text-corp-green-400">browse</span>
                </span>
                <span className="text-xs text-dark-600">
                  PDF, DOCX, PNG, JPG, TXT, CSV, MD, JSON — up to 4MB each · multi-select supported
                </span>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button onClick={() => setAddMode(null)} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
        </div>
      )}

      {/* Text input */}
      {addMode === 'text' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-dark-500 mb-1">Title (optional)</label>
            <input
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
              placeholder="e.g., Product one-pager, Pitch deck copy"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-500 mb-1">Content</label>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-3 text-sm text-white focus:border-corp-green-500 focus:outline-none min-h-[150px] resize-y"
              placeholder="Paste your product description, about page text, pitch deck copy, white paper content..."
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button onClick={addText} disabled={adding || !textInput.trim()} className="btn-primary text-sm py-1.5 px-4 disabled:opacity-40">
              {adding ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Saving...</> : 'Add Text'}
            </button>
            <button onClick={() => { setAddMode(null); setTextInput(''); setTextTitle(''); }} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {!loading && sources.length === 0 && !addMode && (
        <p className="text-dark-600 text-xs mt-3">
          Add your website, pitch deck, one-pager, or product docs. The AI uses these to accurately fill your ICP and find the right partners.
        </p>
      )}
    </div>
  );
}
