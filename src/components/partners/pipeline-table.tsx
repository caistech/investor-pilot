'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CompanyLogo } from '@/components/company-logo';
import { STATUS_COLORS } from '@/lib/types';
import type { Partner, PartnerStatus } from '@/lib/types';
import { Loader2, Search, X } from 'lucide-react';

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'scored', label: 'Scored' },
  { key: 'enriched', label: 'Enriched' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'sent', label: 'Sent' },
  { key: 'replied', label: 'Replied' },
] as const;

type FilterKey = typeof FILTER_TABS[number]['key'];

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'scored') return status === 'scored';
  if (filter === 'enriched') return ['contact_found', 'contact_partial'].includes(status);
  if (filter === 'drafted') return ['draft_ready', 'angle_defined'].includes(status);
  if (filter === 'sent') return ['sent', 'follow_up_due'].includes(status);
  if (filter === 'replied') return ['replied', 'meeting_booked', 'qualified', 'active_partner_discussion', 'closed_won'].includes(status);
  return false;
}

function matchesSearch(partner: Partner, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    partner.company_name.toLowerCase().includes(q) ||
    (partner.domain || '').toLowerCase().includes(q) ||
    (partner.category || '').toLowerCase().includes(q) ||
    (partner.contact_name || '').toLowerCase().includes(q) ||
    (partner.contact_email || '').toLowerCase().includes(q) ||
    (partner.partner_type || '').toLowerCase().includes(q)
  );
}

export function PipelineTable({
  partners,
  organisationId,
  productId,
}: {
  partners: Partner[];
  organisationId: string;
  productId: string;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const partnerTypes = ['all', ...Array.from(new Set(partners.map(p => p.partner_type || '').filter(t => t !== '')))];
  const filtered = partners
    .filter(p => matchesFilter(p.status, filter))
    .filter(p => matchesSearch(p, search))
    .filter(p => typeFilter === 'all' || p.partner_type === typeFilter);
  const selectedPartners = filtered.filter(p => selected.has(p.id));

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.id)));
    }
  }

  async function batchAction(action: 'enrich' | 'draft') {
    if (selectedPartners.length === 0) return;
    setLoading(action);
    setMessage(null);

    try {
      const endpoint = `/api/pipeline/${action}`;
      const body = action === 'enrich'
        ? { partner_ids: selectedPartners.map(p => p.id), organisation_id: organisationId }
        : { partner_ids: selectedPartners.map(p => p.id), organisation_id: organisationId, product_id: productId };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        const verb = action === 'enrich' ? 'enriched' : 'drafted';
        setMessage(`${data[verb] || 0} ${verb}, ${data.errors || 0} errors`);
        setSelected(new Set());
        // Reload page to show updated data
        window.location.reload();
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  }

  const counts = {
    all: partners.length,
    scored: partners.filter(p => matchesFilter(p.status, 'scored')).length,
    enriched: partners.filter(p => matchesFilter(p.status, 'enriched')).length,
    drafted: partners.filter(p => matchesFilter(p.status, 'drafted')).length,
    sent: partners.filter(p => matchesFilter(p.status, 'sent')).length,
    replied: partners.filter(p => matchesFilter(p.status, 'replied')).length,
  };

  return (
    <div>
      {/* Search + type filter */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search partners, contacts, categories..."
            className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-9 pr-8 py-2 text-sm focus:border-corp-green-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-300 focus:border-corp-green-500 focus:outline-none"
        >
          {partnerTypes.map(t => (
            <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
          ))}
        </select>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-dark-700 pb-2">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setFilter(tab.key); setSelected(new Set()); }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === tab.key
                ? 'bg-corp-green-500/20 text-corp-green-400'
                : 'text-dark-400 hover:text-white hover:bg-dark-800'
            }`}
          >
            {tab.label} <span className="text-dark-500 ml-1">{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-dark-800 rounded-lg">
          <span className="text-sm text-dark-300">{selected.size} selected</span>
          <button
            onClick={() => batchAction('enrich')}
            disabled={loading !== null}
            className="btn-secondary text-sm py-1 px-3"
          >
            {loading === 'enrich' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Enrich Selected'}
          </button>
          <button
            onClick={() => batchAction('draft')}
            disabled={loading !== null}
            className="btn-secondary text-sm py-1 px-3"
          >
            {loading === 'draft' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Draft Selected'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-dark-500 text-sm hover:text-white ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.startsWith('Error') ? 'bg-red-500/10 text-red-400' : 'bg-corp-green-500/10 text-corp-green-400'}`}>
          {message}
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-700">
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="rounded border-dark-600"
                  />
                </th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Company</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Category</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Score</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Contact</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className={`border-b border-dark-800 last:border-0 hover:bg-dark-800/50 ${selected.has(p.id) ? 'bg-dark-800/30' : ''}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="rounded border-dark-600"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/partners/${p.id}`} className="flex items-center gap-3 hover:text-corp-green-400">
                      {p.domain ? (
                        <CompanyLogo domain={p.domain} companyName={p.company_name} size={24} />
                      ) : (
                        <div className="w-6 h-6 bg-dark-700 rounded flex items-center justify-center text-xs font-bold">
                          {p.company_name[0]}
                        </div>
                      )}
                      <span className="font-medium">{p.company_name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-dark-400 text-sm">{p.category || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono">{p.weighted_score?.toFixed(1) ?? '—'}</span>
                    {p.confidence_score === 'low-confidence' && (
                      <span className="text-amber-400 text-xs ml-1">low</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {p.contact_name ? (
                      <div>
                        <div>{p.contact_name}</div>
                        <div className="text-dark-500">{p.contact_email || 'no email'}</div>
                      </div>
                    ) : (
                      <span className="text-dark-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={STATUS_COLORS[p.status as PartnerStatus]}>
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card text-center py-12">
          <p className="text-dark-400">No partners in this stage</p>
        </div>
      )}
    </div>
  );
}
