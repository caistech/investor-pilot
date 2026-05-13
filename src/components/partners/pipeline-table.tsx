'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CompanyLogo } from '@/components/company-logo';
import { STATUS_COLORS } from '@/lib/types';
import type { Partner, PartnerStatus } from '@/lib/types';
import { Loader2, Search, X, Send } from 'lucide-react';

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'scored', label: 'Scored' },
  { key: 'enriched', label: 'Enriched' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'sent', label: 'Sent' },
  { key: 'replied', label: 'Replied' },
] as const;

type FilterKey = typeof FILTER_TABS[number]['key'];

// Source-tier filter — combines source + network_distance into one axis
// the operator actually thinks in. "LinkedIn 1st-degree" is meaningfully
// different from "LinkedIn cold" because the sequence template + send
// behaviour differs; the filter mirrors that distinction.
const SOURCE_TABS = [
  { key: 'all', label: 'All sources' },
  { key: 'linkedin_1st', label: 'LinkedIn · 1st' },
  { key: 'linkedin_2nd', label: 'LinkedIn · 2nd' },
  { key: 'linkedin_cold', label: 'LinkedIn · cold' },
  { key: 'brave', label: 'Brave (web)' },
] as const;

type SourceTierKey = typeof SOURCE_TABS[number]['key'];

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'scored') return status === 'scored';
  if (filter === 'enriched') return ['contact_found', 'contact_partial'].includes(status);
  if (filter === 'drafted') return ['draft_ready', 'angle_defined'].includes(status);
  if (filter === 'sent') return ['sent', 'follow_up_due'].includes(status);
  if (filter === 'replied') return ['replied', 'meeting_booked', 'qualified', 'active_partner_discussion', 'closed_won'].includes(status);
  return false;
}

function matchesSourceTier(partner: Partner, filter: SourceTierKey): boolean {
  if (filter === 'all') return true;
  const isLinkedIn = partner.source === 'linkedin' || partner.source === 'sales_nav';
  if (filter === 'linkedin_1st') return isLinkedIn && partner.network_distance === '1st';
  if (filter === 'linkedin_2nd') return isLinkedIn && partner.network_distance === '2nd';
  if (filter === 'linkedin_cold') {
    return isLinkedIn && (partner.network_distance === 'cold' || partner.network_distance == null);
  }
  if (filter === 'brave') return partner.source === 'brave';
  return false;
}

function sourceTierFor(partner: Partner): SourceTierKey {
  const isLinkedIn = partner.source === 'linkedin' || partner.source === 'sales_nav';
  if (isLinkedIn && partner.network_distance === '1st') return 'linkedin_1st';
  if (isLinkedIn && partner.network_distance === '2nd') return 'linkedin_2nd';
  if (isLinkedIn) return 'linkedin_cold';
  if (partner.source === 'brave') return 'brave';
  return 'all';
}

function isOutOfScope(partner: Partner): boolean {
  if (!partner.category) return false;
  return /out[_ -]?of[_ -]?scope/i.test(partner.category);
}

function isAlreadyTargeted(partner: Partner, inFlight: Set<string>): boolean {
  if (CONTACTED_STATUSES.has(partner.status)) return true;
  if (inFlight.has(partner.id)) return true;
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

// Partner statuses that indicate the operator has already contacted the
// person (first touch sent or beyond). Used by the "Hide already targeted"
// filter so we don't accidentally double-send.
const CONTACTED_STATUSES = new Set([
  'sent',
  'follow_up_due',
  'replied',
  'meeting_booked',
  'qualified',
  'active_partner_discussion',
  'closed_won',
  'closed_lost',
  'disqualified',
]);

export function PipelineTable({
  partners,
  organisationId,
  productId,
  inFlightPartnerIds = [],
}: {
  partners: Partner[];
  organisationId: string;
  productId: string;
  inFlightPartnerIds?: string[];
}) {
  const inFlightSet = new Set(inFlightPartnerIds);
  const partnerTypes = ['all', ...Array.from(new Set(partners.map(p => p.partner_type || '').filter(t => t !== '')))];

  // Default the type filter to 'lender' when lender rows exist in the
  // dataset. This hides leftover v2 advisor-channel rows by default while
  // keeping the dropdown switch available. If the org doesn't have any
  // lender rows yet, fall back to 'all'.
  const initialTypeFilter = partnerTypes.includes('lender') ? 'lender' : 'all';

  const [filter, setFilter] = useState<FilterKey>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceTierKey>('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>(initialTypeFilter);
  // Quality filters — compose with status / source / type. Defaults are
  // conservative so the operator sees the full list on first load and
  // explicitly opts into trimming. Min score 0 = no floor; toggles default
  // off so historical data isn't hidden.
  const [minScore, setMinScore] = useState<number>(0);
  const [excludeOutOfScope, setExcludeOutOfScope] = useState<boolean>(false);
  const [hideLowConfidence, setHideLowConfidence] = useState<boolean>(false);
  // "Hide already targeted" = partner has been sent to (status moved past
  // contact_found) OR has an in-flight sequence_steps row. Default ON for
  // batch-assignment workflows so the operator doesn't accidentally
  // double-target. Can be toggled off to see the full list including
  // already-targeted rows.
  const [hideTargeted, setHideTargeted] = useState<boolean>(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const filtered = partners
    .filter(p => matchesFilter(p.status, filter))
    .filter(p => matchesSourceTier(p, sourceFilter))
    .filter(p => matchesSearch(p, search))
    .filter(p => typeFilter === 'all' || p.partner_type === typeFilter)
    .filter(p => (p.weighted_score ?? 0) >= minScore)
    .filter(p => !excludeOutOfScope || !isOutOfScope(p))
    .filter(p => !hideLowConfidence || p.confidence_score !== 'low-confidence')
    .filter(p => !hideTargeted || !isAlreadyTargeted(p, inFlightSet));
  const selectedPartners = filtered.filter(p => selected.has(p.id));

  // Counts for source-tier tabs reflect ALL partners (not respecting the
  // status filter) so the operator can see total volume per source at a
  // glance before narrowing.
  const sourceCounts: Record<SourceTierKey, number> = {
    all: partners.length,
    linkedin_1st: partners.filter(p => matchesSourceTier(p, 'linkedin_1st')).length,
    linkedin_2nd: partners.filter(p => matchesSourceTier(p, 'linkedin_2nd')).length,
    linkedin_cold: partners.filter(p => matchesSourceTier(p, 'linkedin_cold')).length,
    brave: partners.filter(p => matchesSourceTier(p, 'brave')).length,
  };

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

  async function batchAssignSequences() {
    if (selectedPartners.length === 0) return;
    const firstDegreeCount = selectedPartners.filter(p => p.network_distance === '1st').length;
    const otherCount = selectedPartners.length - firstDegreeCount;
    const confirmMsg = `Assign sequences to ${selectedPartners.length} partner${selectedPartners.length === 1 ? '' : 's'}?\n\n` +
      `  • ${firstDegreeCount} 1st-degree → warm DM sequence (3 steps over 9 days)\n` +
      `  • ${otherCount} other → cold sequence (6 steps over 14 days, requires Brave evidence for credit signal)\n\n` +
      `Partners already on a sequence will be skipped.`;
    if (!confirm(confirmMsg)) return;

    setLoading('assign');
    setMessage(null);

    try {
      const res = await fetch('/api/sequences/assign-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_ids: selectedPartners.map(p => p.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
        return;
      }
      const s = data.summary || { assigned: 0, skipped: 0, errored: 0, total_steps: 0 };
      setMessage(
        `${s.assigned} assigned (${s.total_steps} step rows), ${s.skipped} skipped, ${s.errored} errored. ` +
        `Cron will render due steps within 15 min.`,
      );
      setSelected(new Set());
      setTimeout(() => window.location.reload(), 1500);
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
      <div className="flex gap-1 mb-2 border-b border-dark-700 pb-2 flex-wrap">
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

      {/* Source filter tabs — LinkedIn 1st / 2nd / cold / Brave */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {SOURCE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setSourceFilter(tab.key); setSelected(new Set()); }}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              sourceFilter === tab.key
                ? tab.key === 'linkedin_1st'
                  ? 'bg-corp-green-500/20 text-corp-green-400'
                  : tab.key === 'linkedin_2nd'
                  ? 'bg-blue-500/20 text-blue-400'
                  : tab.key === 'brave'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'bg-dark-700 text-dark-200'
                : 'text-dark-400 hover:text-white hover:bg-dark-800'
            }`}
          >
            {tab.label} <span className="text-dark-500 ml-1">{sourceCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      {/* Quality filters — min score, exclude out-of-scope, hide low conf.
          Compose with everything above; batch actions fire on the
          intersection. Layout deliberately compact so it doesn't dominate
          the page above the table. */}
      <div className="flex items-center gap-4 mb-4 text-xs flex-wrap">
        <label className="flex items-center gap-1.5 text-dark-400">
          <span>Min score</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={minScore}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              setMinScore(Number.isFinite(next) ? Math.max(0, Math.min(10, next)) : 0);
              setSelected(new Set());
            }}
            className="w-14 bg-dark-800 border border-dark-700 rounded px-1.5 py-0.5 text-xs text-dark-200 focus:border-corp-green-500 focus:outline-none"
            title="Hide partners with weighted_score below this threshold. 0 = show everything."
          />
          {minScore > 0 && (
            <button
              type="button"
              onClick={() => { setMinScore(0); setSelected(new Set()); }}
              className="text-dark-600 hover:text-dark-300"
              title="Reset to 0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </label>
        <label className="flex items-center gap-1.5 text-dark-400 hover:text-dark-200 cursor-pointer">
          <input
            type="checkbox"
            checked={excludeOutOfScope}
            onChange={(e) => { setExcludeOutOfScope(e.target.checked); setSelected(new Set()); }}
            className="rounded border-dark-600"
          />
          Exclude out-of-scope
        </label>
        <label className="flex items-center gap-1.5 text-dark-400 hover:text-dark-200 cursor-pointer">
          <input
            type="checkbox"
            checked={hideLowConfidence}
            onChange={(e) => { setHideLowConfidence(e.target.checked); setSelected(new Set()); }}
            className="rounded border-dark-600"
          />
          Hide low confidence
        </label>
        <label
          className="flex items-center gap-1.5 text-dark-400 hover:text-dark-200 cursor-pointer"
          title="Hide partners already contacted (status sent / replied / etc.) or with an in-flight sequence."
        >
          <input
            type="checkbox"
            checked={hideTargeted}
            onChange={(e) => { setHideTargeted(e.target.checked); setSelected(new Set()); }}
            className="rounded border-dark-600"
          />
          Hide already targeted
        </label>
        <span className="text-dark-600 ml-auto">
          {filtered.length} of {partners.length} shown
        </span>
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-dark-800 rounded-lg flex-wrap">
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
          <button
            onClick={batchAssignSequences}
            disabled={loading !== null}
            className="btn-primary text-sm py-1 px-3 inline-flex items-center gap-1.5"
            title="Auto-routes: 1st-degree → warm DM sequence, others → cold sequence. Skips partners already on a sequence."
          >
            {loading === 'assign' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Assign Sequences
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
                      <SourceBadge partner={p} />
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

/**
 * Compact source/tier badge for each row. Shows the most specific label
 * available: 'LI 1st' (warm), 'LI 2nd', 'LI cold', or 'Brave'. Hidden
 * when source is unknown so we don't pollute legacy rows that pre-date
 * the source column.
 */
function SourceBadge({ partner }: { partner: Partner }) {
  const tier = sourceTierFor(partner);
  if (tier === 'all') return null;

  const config: Record<Exclude<SourceTierKey, 'all'>, { label: string; cls: string; title: string }> = {
    linkedin_1st: {
      label: 'LI 1st',
      cls: 'bg-corp-green-500/15 text-corp-green-400',
      title: '1st-degree LinkedIn connection — warm DM template, no connect step',
    },
    linkedin_2nd: {
      label: 'LI 2nd',
      cls: 'bg-blue-500/15 text-blue-400',
      title: '2nd-degree LinkedIn connection — cold sequence with credit-signal extraction',
    },
    linkedin_cold: {
      label: 'LI cold',
      cls: 'bg-dark-700 text-dark-300',
      title: 'LinkedIn search result, not a connection — full cold sequence with connect request',
    },
    brave: {
      label: 'Brave',
      cls: 'bg-purple-500/15 text-purple-400',
      title: 'Discovered via Brave web search — company-level row, needs enrichment for email',
    },
  };
  const c = config[tier];
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.cls}`}
      title={c.title}
    >
      {c.label}
    </span>
  );
}
