// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, Package, Sparkles, Loader2, ChevronDown, ChevronRight, Pencil, Trash2, Globe, FileText, Type, Power, PowerOff, Target } from 'lucide-react';
import Link from 'next/link';
import { type Product, PRODUCT_PROSPECT_TYPE_OPTIONS, PRODUCT_PROSPECT_TYPE_BY_VALUE } from '@/lib/types';
import SourceManager from '@/components/products/source-manager';
import { GenerateSequenceButton } from '@/components/settings/generate-sequence-button';
import { GenerateRubricButton } from '@/components/products/generate-rubric-button';
import { PoolStatChip } from '@/components/pool/pool-stat-chip';
import InterviewWizard from '@/components/products/interview-wizard';
import type { SynthesizedProductProfile } from '@/lib/products/interview-synthesizer';

const DETAIL_FIELDS = [
  { key: 'core_mechanism', label: 'Core Mechanism' },
  { key: 'customer_outcomes', label: 'Customer Outcomes (after 90 days)' },
  { key: 'icp_company_size', label: 'ICP Company Size' },
  { key: 'icp_stage', label: 'ICP Stage' },
  // 2026-05-31: geography is the primary input for discovery's query
  // generator. When empty, query-generator.ts defaults targeting to US
  // markets — so an operator who wants (say) Australia must set it here.
  // The form's save handler writes the whole form object, so adding it to
  // this list + EMPTY_FORM is all that's needed for it to persist.
  { key: 'geography', label: 'Geography (target market)' },
  { key: 'icp_verticals', label: 'ICP Verticals' },
  { key: 'icp_buyer_title', label: 'Primary Buyer Title' },
  { key: 'icp_user_title', label: 'Primary User Title' },
  { key: 'icp_stack_tools', label: 'Relevant Stack Tools' },
  { key: 'traction_arr', label: 'Traction / Pricing' },
  { key: 'traction_customers', label: 'Customer Count / Logos' },
  { key: 'partner_types', label: 'Partner Types' },
  { key: 'exclusions', label: 'Exclusions' },
];

const EMPTY_FORM = {
  name: '', one_sentence_description: '', core_mechanism: '',
  customer_outcomes: '', icp_company_size: '', icp_stage: '',
  geography: '',
  icp_verticals: '', icp_buyer_title: '', icp_user_title: '',
  icp_stack_tools: '', traction_arr: '', traction_customers: '',
  partner_types: 'referral', exclusions: '',
  // Operator-picked prospect type — TOP PRIORITY signal to the query
  // generator (the dropdown's describe sentence becomes a non-negotiable
  // instruction at the top of the discovery prompt). One of:
  // 'buyer' / 'referral_partner' / 'integration_partner' / 'reseller' /
  // 'strategic' — see PRODUCT_PROSPECT_TYPE_OPTIONS.
  icp_partner_type: 'buyer',
  // Courtesy-contract attachments — the renderer refuses to draft outreach
  // without at least one (renderer.ts emits 'missing_offering_url' block).
  // Autofill populates these from source_url / KB URL sources so the
  // operator doesn't have to type them manually.
  pitch_deck_url: '',
  one_pager_url: '',
};

interface SetupSnapshot {
  senderConfigured: boolean;
  hasActiveProduct: boolean;
  productPitchConfigured: boolean;
  rubricConfigured: boolean;
  channelConnected: boolean;
  linkedInChannelConnected: boolean;
  emailChannelConnected: boolean;
  sequenceConfigured: boolean;
  allDone: boolean;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  // The AI Interview is a parallel entry point to the manual form: same
  // ultimate destination (the form, then save), but operator answers
  // benefit-framed questions instead of typing 13 free-text fields. Shipped
  // 2026-05-19 after the MMC Build mis-positioning incident showed that
  // operator-typed prose in fields like "verticals" gets read as ground
  // truth by every downstream LLM call.
  const [showInterview, setShowInterview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [filled, setFilled] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<'name' | 'url' | 'text'>('name');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [setup, setSetup] = useState<SetupSnapshot | null>(null);
  const supabase = createClient();

  useEffect(() => {
    loadProducts();
    loadSetupState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSetupState() {
    try {
      const res = await fetch('/api/onboarding/setup-state');
      if (res.ok) {
        const data = await res.json();
        setSetup(data);
        // Add LinkedIn to default sources only if the channel is actually
        // connected. Operator can still toggle Sales Nav on once they have
        // an SN subscription wired up.
        if (data.linkedInChannelConnected) {
          setFindSources((prev) => (prev.includes('linkedin') ? prev : [...prev, 'linkedin']));
        }
      }
    } catch { /* tolerate failure — buttons just won't pre-disable */ }
  }

  async function getOrgId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organisation_id')
      .eq('id', user.id)
      .single();
    return profile?.active_organisation_id || null;
  }

  async function loadProducts() {
    const orgId = await getOrgId();
    if (!orgId) return;
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });
    if (data) setProducts(data as Product[]);
  }

  function canAutoFill(): boolean {
    if (sourceMode === 'url') return !!sourceUrl.trim();
    if (sourceMode === 'text') return !!sourceText.trim();
    return !!form.name.trim();
  }

  async function handleAutoFill() {
    if (!canAutoFill()) return;
    setFilling(true);
    setError(null);

    try {
      const res = await fetch('/api/agent/autofill-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name || undefined,
          description: form.one_sentence_description || undefined,
          source_url: sourceMode === 'url' ? sourceUrl : undefined,
          source_text: sourceMode === 'text' ? sourceText : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 422 from a failed scrape — surface inline so user can switch to
        // Paste Text mode rather than re-submitting and getting the same
        // failure, or worse a hallucinated description (the previous bug).
        const msg = data.error || `Auto-fill failed (HTTP ${res.status})`;
        const help = data.help ? `\n\n${data.help}` : '';
        setError(`${msg}${help}`);
        return;
      }

      setForm((prev) => ({
        ...prev,
        name: data.name || prev.name,
        one_sentence_description: data.one_sentence_description || prev.one_sentence_description,
        core_mechanism: data.core_mechanism || '',
        customer_outcomes: data.customer_outcomes || '',
        icp_company_size: data.icp_company_size || '',
        icp_stage: data.icp_stage || '',
        geography: data.geography || '',
        icp_verticals: data.icp_verticals || '',
        icp_buyer_title: data.icp_buyer_title || '',
        icp_user_title: data.icp_user_title || '',
        icp_stack_tools: data.icp_stack_tools || '',
        traction_arr: data.traction_arr || '',
        traction_customers: data.traction_customers || '',
        partner_types: data.partner_types || 'referral',
        exclusions: data.exclusions || '',
        icp_partner_type: data.icp_partner_type || prev.icp_partner_type || 'buyer',
        // Autofill resolves one_pager_url from source_url / KB URL sources
        // so the renderer-required field is filled in without operator typing.
        one_pager_url: data.one_pager_url || prev.one_pager_url || '',
        pitch_deck_url: data.pitch_deck_url || prev.pitch_deck_url || '',
      }));
      setFilled(true);
      setShowDetails(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-fill failed — network error');
    }
    setFilling(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const orgId = await getOrgId();
    if (!orgId) {
      setError('Could not find your organisation. Try refreshing the page.');
      setLoading(false);
      return;
    }

    if (editingId) {
      await supabase.from('products').update(form).eq('id', editingId);
      // Save source URL to knowledge base if provided and not already saved
      if (sourceUrl.trim()) {
        const { data: existing } = await supabase
          .from('product_sources')
          .select('id')
          .eq('product_id', editingId)
          .eq('source_type', 'url')
          .eq('url', sourceUrl.trim())
          .limit(1)
          .single();
        if (!existing) {
          await supabase.from('product_sources').insert({
            product_id: editingId,
            organisation_id: orgId,
            source_type: 'url',
            title: sourceUrl.trim(),
            url: sourceUrl.trim(),
            processing_status: 'completed',
          });
        }
      }
    } else {
      const { data: newProduct } = await supabase.from('products').insert({
        ...form,
        organisation_id: orgId,
      }).select('id').single();

      // Save source URL to knowledge base if provided
      if (newProduct && sourceUrl.trim()) {
        await supabase.from('product_sources').insert({
          product_id: newProduct.id,
          organisation_id: orgId,
          source_type: 'url',
          title: sourceUrl.trim(),
          url: sourceUrl.trim(),
          processing_status: 'completed',
        });
      }
    }

    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFilled(false);
    setShowDetails(false);
    loadProducts();
    setLoading(false);
  }

  function startEdit(product: Product) {
    setForm({
      name: product.name,
      one_sentence_description: product.one_sentence_description || '',
      core_mechanism: product.core_mechanism || '',
      customer_outcomes: product.customer_outcomes || '',
      icp_company_size: product.icp_company_size || '',
      icp_stage: product.icp_stage || '',
      // Must be loaded here — handleSave writes the whole form object via
      // update(form), so a missing geography key would null the column on
      // every edit-save. Cast because the generated Product type may not
      // yet list geography.
      geography: (product as unknown as { geography?: string }).geography || '',
      icp_verticals: product.icp_verticals || '',
      icp_buyer_title: product.icp_buyer_title || '',
      icp_user_title: product.icp_user_title || '',
      icp_stack_tools: product.icp_stack_tools || '',
      traction_arr: product.traction_arr || '',
      traction_customers: product.traction_customers || '',
      partner_types: product.partner_types || 'referral',
      exclusions: product.exclusions || '',
      icp_partner_type: product.icp_partner_type || 'buyer',
      pitch_deck_url: (product as unknown as { pitch_deck_url?: string }).pitch_deck_url || '',
      one_pager_url: (product as unknown as { one_pager_url?: string }).one_pager_url || '',
    });
    setEditingId(product.id);
    setFilled(true);
    setShowDetails(true);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    await supabase.from('products').delete().eq('id', id);
    loadProducts();
  }

  async function toggleActive(p: Product) {
    await supabase
      .from('products')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    loadProducts();
  }

  // Find Buyers button state — products target buyers (channel partners /
  // direct customers / decision-makers at companies that would purchase
  // what the product sells). Projects (the funding side) target investors;
  // they live on a separate page and use the same engine with project-
  // specific copy. Don't conflate the two on this page.
  const [findingFor, setFindingFor] = useState<string | null>(null);
  // Default chosen reactively from setup state: include LinkedIn only when a
  // LinkedIn channel is actually connected. Without this, the discover-batch
  // route burns 6-9 LinkedIn queries that all fail with "no LinkedIn channel
  // connected" before falling back to Brave-only results.
  const [findSources, setFindSources] = useState<Array<'linkedin' | 'sales_nav' | 'brave'>>(['brave']);
  const [findResult, setFindResult] = useState<{
    productId: string;
    queries_used: Array<{ query: string; rationale: string; category: string }>;
    candidates_found: number;
    candidates_scored: number;
    candidates_failed: number;
    candidates_unique: number;
    candidates_discarded: number;
    tier_breakdown?: { '1st'?: number; '2nd'?: number; cold?: number };
    top_results: Array<{ company_name: string; weighted_score: number; source: string; partner_id?: string; network_distance?: string }>;
    search_errors?: Array<{ query: string; source: string; tier: string; error: string }>;
    error?: string;
  } | null>(null);

  function toggleFindSource(s: 'linkedin' | 'sales_nav' | 'brave') {
    setFindSources(prev => {
      if (prev.includes(s)) {
        const next = prev.filter(p => p !== s);
        return next.length === 0 ? prev : next;
      }
      return [...prev, s];
    });
  }

  // Polling status — replaces the single in-flight "finding" boolean.
  // Background-job pattern (2026-05-21): POST returns immediately with
  // a job_id; we poll /api/pipeline/discover-jobs/[id] every 3s until
  // status is 'completed' or 'failed'.
  const [findStatus, setFindStatus] = useState<'pending' | 'running' | null>(null);

  async function findBuyersForProduct(productId: string) {
    if (!confirm('This runs a multi-query discovery batch in the background (~1-3 minutes). Score budget: up to 150 candidates. Continue?')) return;
    setFindingFor(productId);
    setFindStatus('pending');
    setFindResult(null);
    try {
      // Defensive: even if state somehow includes LinkedIn while no channel
      // exists (race condition with channel disconnect), strip it before
      // sending so the batch doesn't waste queries on failed searches.
      const safeSources = setup && !setup.linkedInChannelConnected
        ? findSources.filter((s) => s !== 'linkedin' && s !== 'sales_nav')
        : findSources;
      if (safeSources.length === 0) {
        setFindResult({
          productId,
          queries_used: [],
          candidates_found: 0,
          candidates_scored: 0,
          candidates_failed: 0,
          candidates_unique: 0,
          candidates_discarded: 0,
          top_results: [],
          error: 'No sources selected. Connect a LinkedIn channel or keep Brave enabled.',
        });
        setFindingFor(null);
        setFindStatus(null);
        return;
      }
      // POST returns { ok, job_id } immediately. The actual work runs on
      // the cron worker against the 300s function ceiling.
      const res = await fetch('/api/pipeline/discover-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, sources: safeSources }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        setFindResult({
          productId,
          queries_used: [],
          candidates_found: 0,
          candidates_scored: 0,
          candidates_failed: 0,
          candidates_unique: 0,
          candidates_discarded: 0,
          top_results: [],
          error: data.error || 'Discovery batch failed to queue',
        });
        setFindingFor(null);
        setFindStatus(null);
        return;
      }
      // Poll until completed or failed. Hard ceiling at 8 min — well past
      // the worker's 300s budget but a safety net against a stalled cron.
      const jobId: string = data.job_id;
      const pollStart = Date.now();
      const MAX_POLL_MS = 8 * 60 * 1000;
      const POLL_INTERVAL_MS = 3000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() - pollStart > MAX_POLL_MS) {
          setFindResult({
            productId,
            queries_used: [],
            candidates_found: 0,
            candidates_scored: 0,
            candidates_failed: 0,
            candidates_unique: 0,
            candidates_discarded: 0,
            top_results: [],
            error: 'Discovery job is taking longer than expected. Check Prospects in a few minutes — results will land there.',
          });
          break;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(`/api/pipeline/discover-jobs/${jobId}`);
        if (!pollRes.ok) {
          // Transient — keep polling unless we hit the ceiling.
          continue;
        }
        const pollData = await pollRes.json();
        if (pollData.status === 'pending' || pollData.status === 'running') {
          setFindStatus(pollData.status);
          continue;
        }
        if (pollData.status === 'failed') {
          setFindResult({
            productId,
            queries_used: [],
            candidates_found: 0,
            candidates_scored: 0,
            candidates_failed: 0,
            candidates_unique: 0,
            candidates_discarded: 0,
            top_results: [],
            error: pollData.error || 'Discovery job failed',
          });
          break;
        }
        if (pollData.status === 'completed') {
          const r = pollData.result || {};
          setFindResult({
            productId,
            queries_used: r.queries_used || [],
            candidates_found: r.candidates_found || 0,
            candidates_scored: r.candidates_scored || 0,
            candidates_failed: r.candidates_failed || 0,
            candidates_unique: r.candidates_unique || 0,
            candidates_discarded: r.candidates_discarded || 0,
            tier_breakdown: r.tier_breakdown,
            top_results: r.top_results || [],
            search_errors: r.search_errors || [],
          });
          break;
        }
      }
    } catch (err) {
      setFindResult({
        productId,
        queries_used: [],
        candidates_found: 0,
        candidates_scored: 0,
        candidates_failed: 0,
        candidates_unique: 0,
        candidates_discarded: 0,
        top_results: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFindingFor(null);
      setFindStatus(null);
    }
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFilled(false);
    setShowDetails(false);
    setSourceMode('name');
    setSourceUrl('');
    setSourceText('');
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Products</h1>
          <p className="text-dark-400 mt-1">Define your product profiles for partner discovery</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setShowInterview(true); setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); setFilled(false); }}
            className="btn-primary flex items-center gap-2"
            title="Answer a few short questions; the system synthesizes the product profile for you to review and edit before save. Recommended for new products — produces better-framed pitch and ICP fields than typing the full form by hand."
          >
            <Sparkles className="w-4 h-4" /> Use AI Interview
          </button>
          <button
            onClick={() => { setShowForm(true); setShowInterview(false); }}
            className="btn-secondary flex items-center gap-2"
            title="Type all product fields directly. Use this if you've already drafted the copy elsewhere and want to paste it in."
          >
            <Plus className="w-4 h-4" /> Add manually
          </button>
        </div>
      </div>

      {showInterview && (
        <div className="mb-8">
          <InterviewWizard
            onSynthesized={(profile: SynthesizedProductProfile) => {
              // Populate the existing manual form with the synthesized fields
              // so the operator can review and edit before save. We DON'T
              // auto-save — the operator must see and approve the structured
              // version before it lands. icp_partner_type defaults to 'buyer'
              // since the interview question set is sales-side; the operator
              // can change it in the form if the product targets a different
              // prospect type.
              setForm((prev) => ({
                ...prev,
                name: profile.name,
                one_sentence_description: profile.one_sentence_description,
                core_mechanism: profile.core_mechanism,
                customer_outcomes: profile.customer_outcomes,
                icp_company_size: profile.icp_company_size,
                icp_stage: profile.icp_stage,
                geography: profile.geography,
                icp_verticals: profile.icp_verticals,
                icp_buyer_title: profile.icp_buyer_title,
                icp_user_title: profile.icp_user_title,
                icp_stack_tools: profile.icp_stack_tools,
                traction_arr: profile.traction_arr,
                traction_customers: profile.traction_customers,
                partner_types: 'referral',
                exclusions: profile.exclusions,
                icp_partner_type: 'buyer',
                // Preserve any URL fields the operator added pre-interview
                // (or auto-populated from KB sources). The interview
                // synthesizer doesn't produce URLs — those land via the
                // form's autofill or the KB ingestion.
                pitch_deck_url: prev.pitch_deck_url || '',
                one_pager_url: prev.one_pager_url || '',
              }));
              setShowInterview(false);
              setShowForm(true);
              setFilled(true);
              setShowDetails(true);
            }}
            onCancel={() => setShowInterview(false)}
          />
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="card mb-8">
          <h3 className="mb-4">{editingId ? 'Edit Product' : 'New Product Profile'}</h3>

          {!filled && !editingId && (
            <div className="mb-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-dark-300">
              <p className="font-medium text-blue-400 mb-1">💡 If you have PDFs or memoranda, save now and skip auto-fill</p>
              <p className="text-dark-400">
                Type a name, click <span className="text-dark-200">Create Product</span>, then upload your PDFs in the Knowledge Base on the expanded card. The <span className="text-corp-green-400">Auto-fill from KB</span> button on the saved product reads those docs and writes ICP fields that reflect the actual material — way more accurate than guessing from a URL.
              </p>
            </div>
          )}

          {/* Source mode tabs */}
          {!filled && !editingId && (
            <div className="flex gap-1 p-1 bg-dark-800 rounded-lg mb-6 w-fit">
              {[
                { mode: 'name' as const, icon: Type, label: 'Product Name' },
                { mode: 'url' as const, icon: Globe, label: 'Website URL' },
                { mode: 'text' as const, icon: FileText, label: 'Paste Text' },
              ].map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSourceMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    sourceMode === mode
                      ? 'bg-dark-600 text-white'
                      : 'text-dark-400 hover:text-dark-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          )}

          {/* Source inputs */}
          <div className="space-y-4 mb-6">
            {sourceMode === 'url' && !filled && !editingId ? (
              <div>
                <label className="block text-sm text-dark-300 mb-1">
                  Product website or landing page URL
                </label>
                <input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2 text-white focus:border-corp-green-500 focus:outline-none"
                  placeholder="https://yourproduct.com"
                  type="url"
                />
                <p className="text-dark-600 text-xs mt-1">We'll extract product details, ICP, and pricing from the page</p>
              </div>
            ) : sourceMode === 'text' && !filled && !editingId ? (
              <div>
                <label className="block text-sm text-dark-300 mb-1">
                  Paste product description, pitch deck text, or collateral
                </label>
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-3 text-white focus:border-corp-green-500 focus:outline-none min-h-[120px] resize-y"
                  placeholder="Paste your product one-pager, about page copy, pitch deck text, or any product description..."
                />
                <p className="text-dark-600 text-xs mt-1">The more detail you provide, the better the auto-fill</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-dark-300 mb-1">Product Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2 text-white focus:border-corp-green-500 focus:outline-none"
                    placeholder="e.g., R&D Tax Tracker"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-300 mb-1">One-sentence Description <span className="text-dark-600">(optional — AI can generate this)</span></label>
                  <input
                    value={form.one_sentence_description}
                    onChange={(e) => setForm({ ...form, one_sentence_description: e.target.value })}
                    className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2 text-white focus:border-corp-green-500 focus:outline-none"
                    placeholder="What does this product do in one sentence?"
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-300 mb-1">
                    Who do we want to reach?
                    <span className="text-dark-600 ml-1">(drives Discovery — picks the right prospect type)</span>
                  </label>
                  <select
                    value={form.icp_partner_type}
                    onChange={(e) => setForm({ ...form, icp_partner_type: e.target.value })}
                    className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2 text-white focus:border-corp-green-500 focus:outline-none"
                  >
                    {PRODUCT_PROSPECT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {form.icp_partner_type && PRODUCT_PROSPECT_TYPE_BY_VALUE[form.icp_partner_type] && (
                    <p className="text-xs text-dark-500 mt-1 leading-snug">
                      {PRODUCT_PROSPECT_TYPE_BY_VALUE[form.icp_partner_type].describe}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* AI Auto-Fill Button */}
          {!filled && (
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={filling || !canAutoFill()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all duration-200 disabled:opacity-40 bg-gradient-to-r from-corp-green-500 to-corp-green-600 hover:from-corp-green-600 hover:to-corp-green-700 text-white shadow-lg shadow-corp-green-500/25 mb-6"
            >
              {filling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {sourceMode === 'url' ? 'Extracting from website...' : sourceMode === 'text' ? 'Extracting from content...' : 'Generating ICP profile...'}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {sourceMode === 'url' ? 'Extract from website' : sourceMode === 'text' ? 'Extract from text' : 'Auto-fill with AI'}
                </>
              )}
            </button>
          )}

          {/* Step 2: Auto-filled details (collapsible) */}
          {filled && (
            <>
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-2 text-sm text-dark-400 hover:text-white mb-4 transition-colors"
              >
                {showDetails ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {showDetails ? 'Hide' : 'Show'} ICP details ({DETAIL_FIELDS.filter((f) => (form as Record<string, string>)[f.key]).length} fields populated)
              </button>

              {showDetails && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-dark-800/50 rounded-lg border border-dark-700">
                  {DETAIL_FIELDS.map((f) => (
                    <div key={f.key} className={f.key === 'exclusions' ? 'md:col-span-2' : ''}>
                      <label className="block text-xs text-dark-500 mb-1">{f.label}</label>
                      <input
                        value={(form as Record<string, string>)[f.key]}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                      />
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={() => { setFilled(false); handleAutoFill(); }}
                      className="flex items-center gap-1.5 text-xs text-dark-500 hover:text-corp-green-400 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" /> Re-generate with AI
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Courtesy-contract attachments — surfaced in outreach as the
              value-offer link. Without one_pager_url the renderer refuses
              to draft (blocker: missing_offering_url). Autofill populates
              one_pager_url from source_url so the operator usually only
              needs to confirm. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            <div>
              <label className="block text-sm text-dark-300 mb-1">
                One-pager URL <span className="text-dark-600">— required for outreach</span>
              </label>
              <input
                type="url"
                value={form.one_pager_url || ''}
                onChange={(e) => setForm({ ...form, one_pager_url: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="https://... — your product page, Notion doc, or PDF link"
              />
              <p className="text-xs text-dark-500 mt-1">Surfaced in cold outreach so prospects can self-serve before replying. Auto-populated when you AI-fill from a URL source.</p>
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">
                Pitch deck URL <span className="text-dark-600">— optional</span>
              </label>
              <input
                type="url"
                value={form.pitch_deck_url || ''}
                onChange={(e) => setForm({ ...form, pitch_deck_url: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="https://docsend.com/view/... or Notion / Drive URL"
              />
              <p className="text-xs text-dark-500 mt-1">Heavier-weight alternative to the one-pager. Used in longer email touches when the recipient is engaged.</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={loading || !form.name.trim()} className="btn-primary disabled:opacity-50">
              {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Create Product'}
            </button>
            <button type="button" onClick={cancelForm} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {products.length > 0 ? (
        <div className="space-y-3">
          {products.map((p) => (
            <div key={p.id} className="card-hover">
              <button
                onClick={() => setExpandedProduct(expandedProduct === p.id ? null : p.id)}
                className="flex items-center gap-3 w-full text-left"
              >
                <Package className="w-5 h-5 text-corp-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate">{p.name}</h4>
                    {p.is_active ? (
                      <span className="badge-green">Active</span>
                    ) : (
                      <span className="badge-amber">Inactive</span>
                    )}
                  </div>
                  <p className="text-dark-400 text-sm truncate">{p.one_sentence_description || 'No description'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-dark-600 text-xs hidden lg:inline">{p.partner_types}</span>
                  <PoolStatChip kind="product" ownerId={p.id} ownerName={p.name} />
                  {expandedProduct === p.id ? (
                    <ChevronDown className="w-4 h-4 text-dark-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dark-500" />
                  )}
                </div>
              </button>

              {expandedProduct === p.id && (
                <div className="mt-4 pt-4 border-t border-dark-800">
                  {/* Display-only summary of the product's basic ICP fields */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-6">
                    {[
                      { label: 'Core Mechanism', value: p.core_mechanism },
                      { label: 'Customer Outcomes', value: p.customer_outcomes },
                      { label: 'Company Size', value: p.icp_company_size },
                      { label: 'Stage', value: p.icp_stage },
                      { label: 'Geography', value: (p as unknown as { geography?: string }).geography },
                      { label: 'Verticals', value: p.icp_verticals },
                      { label: 'Buyer Title', value: p.icp_buyer_title },
                      { label: 'User Title', value: p.icp_user_title },
                      { label: 'Stack Tools', value: p.icp_stack_tools },
                      { label: 'Traction', value: p.traction_arr },
                      { label: 'Customers', value: p.traction_customers },
                      { label: 'Exclusions', value: p.exclusions },
                    ].filter((f) => f.value).map((f) => (
                      <div key={f.label}>
                        <span className="text-dark-600 text-xs">{f.label}</span>
                        <p className="text-dark-300">{f.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ───────────────────────────────────────────────────────────
                       Setup flow — top-to-bottom in the order the operator
                       needs to act. Upload knowledge first, then let the AI
                       build the rubric + sequence from the full context, then
                       run discovery. */}

                  {/* Step 0: Knowledge Base — uploaded sources back-fill the AI
                       prompts in Steps 1 & 2. MUST come before generation so
                       the rubric/sequence reflect actual collateral, not just
                       the product row. */}
                  <div className="mb-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold">0</span>
                      <p className="text-sm font-medium text-purple-300">Knowledge Base — upload everything first</p>
                    </div>
                    <p className="text-dark-500 text-xs mt-0.5 mb-3 ml-7">
                      Add product collateral (PDFs, URLs, pasted text). Step 1 and Step 2 read from
                      this — the more uploaded, the more accurate the auto-generated rubric and outreach copy.
                    </p>
                    <div className="ml-7">
                      <SourceManager productId={p.id} />
                    </div>
                  </div>
                  {/* ───────────────────────────────────────────────────────────
                       Setup steps before discovery — eye flows top-to-bottom in
                       the order the operator needs to act. Step 1 (rubric) and
                       Step 2 (sequence) are both required before Step 3 (Find
                       Buyers) will run. */}

                  {/* Step 1: ICP scoring rubric — required for Find Buyers */}
                  <div className="mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">1</span>
                      <p className="text-sm font-medium text-amber-400">
                        ICP scoring rubric {(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? '— configured ✓' : '— not configured'}
                      </p>
                    </div>
                    <p className="text-dark-500 text-xs mt-0.5 mb-3 ml-7">
                      The detailed rubric the discovery scorer uses to rank candidates 1–10 across the 5 dimensions for this product&apos;s audience. <strong className="text-amber-300">Required before Find Buyers can run.</strong>
                    </p>
                    <div className="ml-7">
                      <GenerateRubricButton
                        productId={p.id}
                        alreadyConfigured={!!(p as unknown as { scoring_rubric?: string | null }).scoring_rubric}
                        disabledReason={
                          !p.is_active
                            ? 'Activate this product first.'
                            : !p.one_sentence_description && !(p as unknown as { product_pitch?: string | null }).product_pitch
                              ? 'This product has no description or pitch yet — add one before generating a rubric.'
                              : null
                        }
                        disabledFixHref="/products"
                        disabledFixLabel="Edit product"
                        onSuccess={() => { loadProducts(); loadSetupState(); }}
                      />
                    </div>
                  </div>

                  {/* Step 2: Outreach sequence — required before approvals queue can render drafts */}
                  <div className="mb-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold">2</span>
                      <p className="text-sm font-medium text-blue-400">Outreach sequence</p>
                    </div>
                    <p className="text-dark-500 text-xs mt-0.5 mb-3 ml-7">
                      Generate a 6-step LinkedIn + email sequence tailored to this product&apos;s pitch and ICP. Replaces any prior auto-generated sequence for this audience.
                    </p>
                    <div className="ml-7">
                      <GenerateSequenceButton
                        productId={p.id}
                        variant="secondary"
                        label="Generate / regenerate sequence"
                        confirmBeforeRun
                        disabledReason={
                          !p.is_active
                            ? 'Activate this product first.'
                            : setup && !setup.senderConfigured
                              ? 'Sender identity is not set — the sequence needs your name and role to sign the messages.'
                              : !p.one_sentence_description && !(p as unknown as { product_pitch?: string | null }).product_pitch
                                ? 'Product has no description or pitch — add one before generating the sequence copy.'
                                : null
                        }
                        disabledFixHref={setup && !setup.senderConfigured ? '/settings' : '/products'}
                        disabledFixLabel={setup && !setup.senderConfigured ? 'Set sender identity' : 'Edit product'}
                        onSuccess={() => { loadProducts(); loadSetupState(); }}
                      />
                    </div>
                  </div>

                  {/* Step 3: Find Buyers — the v3 batch discovery button.
                       Disabled when the rubric (Step 1) hasn't been generated yet
                       so users can't reach the same "scoring_rubric not set" dead-end. */}
                  <div className={`mb-4 p-3 rounded-lg border ${(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? 'bg-corp-green-500/5 border-corp-green-500/20' : 'bg-dark-900/50 border-dark-700'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? 'bg-corp-green-500/20 text-corp-green-400' : 'bg-dark-700 text-dark-500'}`}>3</span>
                          <p className={`text-sm font-medium ${(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? 'text-corp-green-400' : 'text-dark-400'}`}>Find buyers for this product</p>
                        </div>
                        <p className="text-dark-500 text-xs mt-0.5 ml-7">
                          {(p as unknown as { scoring_rubric?: string | null }).scoring_rubric
                            ? 'Generates 5-8 targeted queries from the Knowledge Base and runs them across selected sources. Tier-prioritised: your 1st-degree connections surface first, then 2nd-degree, then cold. ~2-5 min.'
                            : 'Complete Step 1 above (generate the ICP scoring rubric) to unlock discovery.'}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                          {([
                            { key: 'sales_nav' as const, label: 'Sales Nav', hint: 'Richer filters (seniority, function, years in role). Requires SN subscription.', needsLinkedIn: true },
                            { key: 'linkedin' as const, label: 'LinkedIn', hint: 'Classic LinkedIn people search. Requires a connected LinkedIn channel.', needsLinkedIn: true },
                            { key: 'brave' as const, label: 'Brave', hint: 'Supplementary web search — fund reports, news, deal mentions.', needsLinkedIn: false },
                          ] as const).map(s => {
                            const blockedByMissingChannel: boolean = !!(s.needsLinkedIn && setup && !setup.linkedInChannelConnected);
                            const disabled: boolean = findingFor !== null || blockedByMissingChannel;
                            return (
                              <button
                                key={s.key}
                                type="button"
                                onClick={() => !blockedByMissingChannel && toggleFindSource(s.key)}
                                disabled={disabled}
                                className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium transition-colors ${
                                  findSources.includes(s.key) && !blockedByMissingChannel
                                    ? 'bg-corp-green-500/20 text-corp-green-400 border border-corp-green-500/40'
                                    : blockedByMissingChannel
                                      ? 'bg-dark-900 text-dark-600 border border-dark-800 cursor-not-allowed'
                                      : 'bg-dark-800 text-dark-500 border border-dark-700 hover:text-dark-300'
                                }`}
                                title={blockedByMissingChannel ? 'Connect a LinkedIn channel first (Channels → Connect LinkedIn)' : s.hint}
                              >
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                        {setup && !setup.linkedInChannelConnected && (
                          <p className="text-xs text-amber-400 mt-2">
                            LinkedIn + Sales Nav are disabled — <Link href="/channels" className="underline hover:text-amber-300">connect a LinkedIn channel</Link> to enable them. Brave still works on its own (web search).
                          </p>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); findBuyersForProduct(p.id); }}
                        disabled={findingFor !== null || !p.is_active || !(p as unknown as { scoring_rubric?: string | null }).scoring_rubric}
                        className="btn-primary text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          !p.is_active
                            ? 'Activate this product first'
                            : !(p as unknown as { scoring_rubric?: string | null }).scoring_rubric
                              ? 'Generate the ICP scoring rubric (Step 1) before running discovery'
                              : 'Run discovery batch'
                        }
                      >
                        {findingFor === p.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {findStatus === 'pending'
                              ? 'Queued…'
                              : findStatus === 'running'
                                ? 'Running…'
                                : 'Finding…'}
                          </>
                        ) : (
                          <><Target className="w-4 h-4" /> Find Buyers</>
                        )}
                      </button>
                    </div>

                    {findResult && findResult.productId === p.id && (
                      <div className="mt-3 pt-3 border-t border-corp-green-500/20 space-y-2">
                        {findResult.error ? (
                          <p className="text-red-400 text-xs">{findResult.error}</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Raw candidates Brave + LinkedIn returned before any filter">
                                <p className="text-dark-500">Found</p>
                                <p className="font-mono font-bold">{findResult.candidates_found}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Reached the Prospects list (passed scoring, has a real contact + email)">
                                <p className="text-dark-500">Kept</p>
                                <p className="font-mono font-bold text-corp-green-400">{findResult.candidates_scored}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Scored but dropped: out-of-scope OR no email OR no real contact name. Strict 2-bucket rule — Prospects only keeps contactable rows.">
                                <p className="text-dark-500">Discarded</p>
                                <p className="font-mono font-bold text-dark-300">{findResult.candidates_discarded}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5">
                                <p className="text-dark-500">Top fit</p>
                                <p className="font-mono font-bold">
                                  {findResult.top_results[0]?.weighted_score?.toFixed(1) ?? '—'}
                                </p>
                              </div>
                            </div>

                            {findResult.tier_breakdown && (
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-corp-green-500/10 border border-corp-green-500/20 rounded px-2 py-1.5">
                                  <p className="text-corp-green-400 text-[10px] uppercase tracking-wide">1st-degree</p>
                                  <p className="font-mono font-bold text-corp-green-400">{findResult.tier_breakdown['1st'] || 0}</p>
                                  <p className="text-dark-500 text-[10px]">warm DMs</p>
                                </div>
                                <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1.5">
                                  <p className="text-blue-400 text-[10px] uppercase tracking-wide">2nd-degree</p>
                                  <p className="font-mono font-bold text-blue-400">{findResult.tier_breakdown['2nd'] || 0}</p>
                                  <p className="text-dark-500 text-[10px]">warm cold</p>
                                </div>
                                <div className="bg-dark-700/40 border border-dark-700 rounded px-2 py-1.5">
                                  <p className="text-dark-400 text-[10px] uppercase tracking-wide">Cold</p>
                                  <p className="font-mono font-bold text-dark-300">{findResult.tier_breakdown.cold || 0}</p>
                                  <p className="text-dark-500 text-[10px]">cold sequence</p>
                                </div>
                              </div>
                            )}
                            {findResult.top_results.length > 0 && (
                              <Link
                                href="/partners"
                                className="block text-xs text-corp-green-400 hover:text-corp-green-300 underline mt-1"
                              >
                                View {findResult.top_results.length} top-scored prospects in Prospects →
                              </Link>
                            )}
                            {findResult.queries_used.length > 0 && (
                              <details className="text-xs">
                                <summary className="text-dark-500 cursor-pointer hover:text-dark-300">
                                  Queries used ({findResult.queries_used.length})
                                </summary>
                                <ul className="mt-2 space-y-1 text-dark-400">
                                  {findResult.queries_used.map((q, i) => (
                                    <li key={i} className="flex flex-col gap-0.5 pl-2 border-l border-dark-700">
                                      <code className="text-corp-green-300">{q.query}</code>
                                      <span className="text-dark-600 text-[10px]">{q.category} — {q.rationale}</span>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}

                            {findResult.search_errors && findResult.search_errors.length > 0 && (
                              <details className="text-xs" open={findResult.candidates_scored === 0}>
                                <summary className="text-red-400 cursor-pointer hover:text-red-300">
                                  ⚠ Search errors ({findResult.search_errors.length})
                                </summary>
                                <ul className="mt-2 space-y-1 text-red-300">
                                  {findResult.search_errors.map((e, i) => (
                                    <li key={i} className="flex flex-col gap-0.5 pl-2 border-l border-red-500/30">
                                      <span className="font-mono text-[10px] text-red-400">
                                        {e.source} / {e.tier} — {e.query}
                                      </span>
                                      <code className="text-red-300 text-[10px] break-all">{e.error}</code>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-4 mb-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                      className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-white transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(p); }}
                      className={`flex items-center gap-1.5 text-sm transition-colors ${
                        p.is_active
                          ? 'text-dark-400 hover:text-amber-400'
                          : 'text-dark-400 hover:text-corp-green-400'
                      }`}
                      title={p.is_active ? 'Deactivate — stops this product from being used by discover/draft' : 'Activate — make this product available to the pipeline'}
                    >
                      {p.is_active ? (
                        <><PowerOff className="w-3.5 h-3.5" /> Mark Inactive</>
                      ) : (
                        <><Power className="w-3.5 h-3.5" /> Mark Active</>
                      )}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                      className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>

                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-16">
          <Package className="w-12 h-12 text-dark-600 mx-auto mb-4" />
          <p className="text-dark-400">No products yet. Add your first product to start discovering partners.</p>
        </div>
      )}
    </div>
  );
}
