'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, Package, Sparkles, Loader2, ChevronDown, ChevronRight, Pencil, Trash2, Globe, FileText, Type, Power, PowerOff } from 'lucide-react';
import type { Product } from '@/lib/types';
import SourceManager from '@/components/products/source-manager';

const DETAIL_FIELDS = [
  { key: 'core_mechanism', label: 'Core Mechanism' },
  { key: 'customer_outcomes', label: 'Customer Outcomes (after 90 days)' },
  { key: 'icp_company_size', label: 'ICP Company Size' },
  { key: 'icp_stage', label: 'ICP Stage' },
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
  icp_verticals: '', icp_buyer_title: '', icp_user_title: '',
  icp_stack_tools: '', traction_arr: '', traction_customers: '',
  partner_types: 'referral', exclusions: '',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
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
  const supabase = createClient();

  useEffect(() => {
    loadProducts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getOrgId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('organisation_id')
      .eq('id', user.id)
      .single();
    return profile?.organisation_id || null;
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

      if (res.ok) {
        const data = await res.json();
        setForm((prev) => ({
          ...prev,
          name: data.name || prev.name,
          one_sentence_description: data.one_sentence_description || prev.one_sentence_description,
          core_mechanism: data.core_mechanism || '',
          customer_outcomes: data.customer_outcomes || '',
          icp_company_size: data.icp_company_size || '',
          icp_stage: data.icp_stage || '',
          icp_verticals: data.icp_verticals || '',
          icp_buyer_title: data.icp_buyer_title || '',
          icp_user_title: data.icp_user_title || '',
          icp_stack_tools: data.icp_stack_tools || '',
          traction_arr: data.traction_arr || '',
          traction_customers: data.traction_customers || '',
          partner_types: data.partner_types || 'referral',
          exclusions: data.exclusions || '',
        }));
        setFilled(true);
        setShowDetails(true);
      }
    } catch {
      // Silently fail — user can still fill manually
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
      icp_verticals: product.icp_verticals || '',
      icp_buyer_title: product.icp_buyer_title || '',
      icp_user_title: product.icp_user_title || '',
      icp_stack_tools: product.icp_stack_tools || '',
      traction_arr: product.traction_arr || '',
      traction_customers: product.traction_customers || '',
      partner_types: product.partner_types || 'referral',
      exclusions: product.exclusions || '',
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
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="card mb-8">
          <h3 className="mb-4">{editingId ? 'Edit Product' : 'New Product Profile'}</h3>

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
                  <span className="text-dark-600 text-xs">{p.partner_types}</span>
                  {expandedProduct === p.id ? (
                    <ChevronDown className="w-4 h-4 text-dark-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dark-500" />
                  )}
                </div>
              </button>

              {expandedProduct === p.id && (
                <div className="mt-4 pt-4 border-t border-dark-800">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    {[
                      { label: 'Core Mechanism', value: p.core_mechanism },
                      { label: 'Customer Outcomes', value: p.customer_outcomes },
                      { label: 'Company Size', value: p.icp_company_size },
                      { label: 'Stage', value: p.icp_stage },
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

                  {/* Knowledge Base */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <SourceManager productId={p.id} />
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
