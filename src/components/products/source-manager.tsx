'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Globe, FileText, Type, Upload, Loader2, Trash2,
  CheckCircle, XCircle, FileUp, Link2, AlertTriangle,
} from 'lucide-react';
import type { ProductSource } from '@/lib/types';

interface SourceManagerProps {
  productId: string;
}

const FILE_ACCEPT = '.pdf,.docx,.doc,.txt,.csv,.md,.json';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function SourceManager({ productId }: SourceManagerProps) {
  const [sources, setSources] = useState<ProductSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<'url' | 'file' | 'text' | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textInput, setTextInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSources = useCallback(async () => {
    const res = await fetch(`/api/sources?product_id=${productId}`);
    if (res.ok) {
      const data = await res.json();
      setSources(data);
    }
    setLoading(false);
  }, [productId]);

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
          product_id: productId,
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
          product_id: productId,
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

  async function uploadFile(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`);
      return;
    }

    setAdding(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('product_id', productId);

      const res = await fetch('/api/sources', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error_message || data.error || 'Failed to upload file');
      }
      setAddMode(null);
      loadSources();
    } catch {
      setError('Failed to upload file');
    }
    setAdding(false);
  }

  async function deleteSource(id: string) {
    await fetch(`/api/sources?id=${id}`, { method: 'DELETE' });
    loadSources();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
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

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4>Knowledge Base</h4>
          <p className="text-dark-500 text-sm mt-0.5">
            Add your product collateral — the pipeline uses this for accurate partner discovery
          </p>
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
                  Drop a file here or <span className="text-corp-green-400">browse</span>
                </span>
                <span className="text-xs text-dark-600">
                  PDF, DOCX, TXT, CSV, MD, JSON — up to 10MB
                </span>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
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
