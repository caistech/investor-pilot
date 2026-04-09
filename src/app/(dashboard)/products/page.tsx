'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, Package } from 'lucide-react';
import type { Product } from '@/lib/types';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', one_sentence_description: '', core_mechanism: '',
    customer_outcomes: '', icp_company_size: '', icp_stage: '',
    icp_verticals: '', icp_buyer_title: '', icp_user_title: '',
    icp_stack_tools: '', traction_arr: '', traction_customers: '',
    partner_types: 'referral', exclusions: '',
  });
  const supabase = createClient();

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    const { data: profile } = await supabase.from('profiles').select('organisation_id').single();
    if (!profile) return;
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('organisation_id', profile.organisation_id)
      .order('created_at', { ascending: false });
    if (data) setProducts(data as Product[]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data: profile } = await supabase.from('profiles').select('organisation_id').single();
    if (!profile) return;

    await supabase.from('products').insert({
      ...form,
      organisation_id: profile.organisation_id,
    });
    setShowForm(false);
    setForm({ name: '', one_sentence_description: '', core_mechanism: '', customer_outcomes: '', icp_company_size: '', icp_stage: '', icp_verticals: '', icp_buyer_title: '', icp_user_title: '', icp_stack_tools: '', traction_arr: '', traction_customers: '', partner_types: 'referral', exclusions: '' });
    loadProducts();
    setLoading(false);
  }

  const fields = [
    { key: 'name', label: 'Product Name', required: true },
    { key: 'one_sentence_description', label: 'One-sentence Description' },
    { key: 'core_mechanism', label: 'Core Mechanism' },
    { key: 'customer_outcomes', label: 'Customer Outcomes (after 90 days)' },
    { key: 'icp_company_size', label: 'ICP Company Size (e.g., 5-200 employees)' },
    { key: 'icp_stage', label: 'ICP Stage (e.g., revenue-generating)' },
    { key: 'icp_verticals', label: 'ICP Verticals' },
    { key: 'icp_buyer_title', label: 'Primary Buyer Title' },
    { key: 'icp_user_title', label: 'Primary User Title' },
    { key: 'icp_stack_tools', label: 'Relevant Stack Tools' },
    { key: 'traction_arr', label: 'Traction / Pricing' },
    { key: 'traction_customers', label: 'Customer Count / Logos' },
    { key: 'partner_types', label: 'Partner Types (referral, integration, reseller)' },
    { key: 'exclusions', label: 'Exclusions' },
  ];

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
        <form onSubmit={handleCreate} className="card mb-8">
          <h3 className="mb-4">New Product Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key} className={f.key === 'exclusions' ? 'md:col-span-2' : ''}>
                <label className="block text-sm text-dark-300 mb-1">{f.label}</label>
                <input
                  value={(form as Record<string, string>)[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2 text-white focus:border-corp-green-500 focus:outline-none"
                  required={f.required}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-6">
            <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Product'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {products.length > 0 ? (
        <div className="grid gap-4">
          {products.map((p) => (
            <div key={p.id} className="card-hover">
              <div className="flex items-center gap-3 mb-2">
                <Package className="w-5 h-5 text-corp-green-400" />
                <h4>{p.name}</h4>
                {p.is_active && <span className="badge-green">Active</span>}
              </div>
              <p className="text-dark-400">{p.one_sentence_description || 'No description'}</p>
              <div className="flex gap-4 mt-3 text-sm text-dark-500">
                <span>ICP: {p.icp_verticals || 'Not set'}</span>
                <span>Types: {p.partner_types}</span>
              </div>
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
