'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CompanyLogo } from '@/components/company-logo';
import { STATUS_COLORS } from '@/lib/types';
import type { Partner, PartnerStatus } from '@/lib/types';
import { Loader2, Search, X, Send, ArrowRight } from 'lucide-react';

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

/**
 * Source-aware primary identifier for the Prospect column.
 *
 * LinkedIn-sourced rows are PEOPLE — the contact name is the primary
 * identifier; the firm (if different) appears as a small subtitle.
 *
 * Brave-sourced rows are COMPANIES — the firm is primary; any known
 * contact appears as the subtitle.
 *
 * Unknown source falls back to company_name so legacy rows still render
 * something useful.
 */
function getProspectDisplay(p: Partner): { primary: string; subtitle: string | null } {
  const isLinkedIn = p.source === 'linkedin' || p.source === 'sales_nav';
  if (isLinkedIn) {
    const primary = p.contact_name || p.company_name;
    const firm = p.contact_name && p.company_name !== p.contact_name ? p.company_name : null;
    return { primary, subtitle: firm };
  }
  return {
    primary: p.company_name,
    subtitle: p.contact_name || null,
  };
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

interface DiscoveryRunSummary {
  run_code: string;
  created_at: string;
}

export function PipelineTable({
  partners,
  organisationId,
  productId,
  inFlightPartnerIds = [],
  runsById = {},
  runsForFilter = [],
}: {
  partners: Partner[];
  organisationId: string;
  productId: string;
  inFlightPartnerIds?: string[];
  // Map of discovery_runs.id → { run_code, created_at } for annotating
  // each prospect row with its origin run. Empty for orgs that have never
  // run discover-batch since migration 010 shipped.
  runsById?: Record<string, DiscoveryRunSummary>;
  // Ordered list (newest first) for the filter-by-run dropdown.
  runsForFilter?: Array<{ id: string; run_code: string; created_at: string }>;
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
  // Filter by origin discovery run. 'all' = any/no run, '<run_id>' = only
  // rows first surfaced by that run. Useful for "what did this last run
  // bring in?" sanity-checks.
  const [runFilter, setRunFilter] = useState<string>('all');
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
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Optional follow-up call-to-action shown beneath the status message —
  // e.g. after Draft completes, link the operator straight to /approvals
  // so there is no doubt about where the messages went.
  const [nextCta, setNextCta] = useState<{ href: string; label: string } | null>(null);
  const filtered = partners
    // Hide rows where the engine couldn't extract a contact_name. Brave
    // sometimes saves listicle titles ("9 Best B2B Sales Prospecting
    // Tools…") or company-only directory pages as partner rows with no
    // person attached — those aren't actionable as prospects (nothing
    // to draft to), so they pollute the view without ever being
    // workable. Operator can enrich-by-domain elsewhere if they want
    // to chase a company without a contact.
    .filter(p => typeof p.contact_name === 'string' && p.contact_name.trim().length > 0)
    .filter(p => matchesFilter(p.status, filter))
    .filter(p => matchesSourceTier(p, sourceFilter))
    .filter(p => matchesSearch(p, search))
    .filter(p => typeFilter === 'all' || p.partner_type === typeFilter)
    .filter(p => (p.weighted_score ?? 0) >= minScore)
    .filter(p => !excludeOutOfScope || !isOutOfScope(p))
    .filter(p => !hideLowConfidence || p.confidence_score !== 'low-confidence')
    .filter(p => !hideTargeted || !isAlreadyTargeted(p, inFlightSet))
    .filter(p => runFilter === 'all'
      || p.first_seen_in_run_id === runFilter
      || p.last_seen_in_run_id === runFilter);
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
    const n = selectedPartners.length;
    setLoading(action);
    setNextCta(null);
    setMessage(
      action === 'enrich'
        ? `Enriching ${n} prospect${n === 1 ? '' : 's'} now — looking up emails via Hunter.io…`
        : `Rendering the first sequence step for ${n} prospect${n === 1 ? '' : 's'} now — these will land in Approvals when done…`,
    );

    try {
      // Enrich runs /api/pipeline/enrich (Hunter.io email lookup).
      // Draft runs /api/sequences/render-now — synchronous trigger of the
      // SAME render path the cron uses, so the rendered message lands in
      // outbound_messages and the sequence_step transitions to
      // queued_for_approval. That's what Approvals reads from. Earlier
      // versions called /api/pipeline/draft which writes to
      // partners.draft_body, which Approvals never sees — operators were
      // promised "Go to Approvals" and arrived at an empty queue.
      const endpoint = action === 'enrich'
        ? '/api/pipeline/enrich'
        : '/api/sequences/render-now';
      const body = action === 'enrich'
        ? { partner_ids: selectedPartners.map(p => p.id), organisation_id: organisationId }
        : { partner_ids: selectedPartners.map(p => p.id) };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        let succeeded: number;
        let errored: number;
        let skipped: number;

        if (action === 'enrich') {
          succeeded = data.enriched || 0;
          errored = data.errors || 0;
          skipped = data.skipped || data.unresolved || 0;
        } else {
          // render-now returns counts from the cron's tally —
          // { queued, compliance_blocked, failed, skipped_no_channel }
          const counts = data.counts || {};
          succeeded = counts.queued || 0;
          errored = (counts.failed || 0) + (counts.compliance_blocked || 0);
          skipped = counts.skipped_no_channel || 0;
        }

        // Use router.refresh() instead of window.location.reload() so the
        // selection survives the server re-fetch — operators previously
        // had to guess which rows they'd just enriched in order to move
        // on to Step 2 (Assign Sequence). The server component re-runs;
        // client state (selected, message) stays put.
        if (succeeded > 0) {
          router.refresh();
        }

        if (action === 'enrich') {
          setMessage(
            `Enriched ${succeeded} of ${n}. ${skipped} skipped, ${errored} errors.\n` +
            `Selection kept — click "2. Assign Sequence" next.`,
          );
          // Selection deliberately kept so the operator can flow into
          // step 2 without re-ticking the same rows.
        } else {
          // Render-now completed → the first message is in Approvals.
          const blockedNote = (data.counts?.compliance_blocked || 0) > 0
            ? ` (${data.counts.compliance_blocked} blocked by compliance — check Approvals to review).`
            : '';
          const channelNote = skipped > 0
            ? ` ${skipped} skipped — no active channel for that step.`
            : '';
          setMessage(
            `Rendered ${succeeded} of ${n}.${blockedNote}${channelNote}\n` +
            (succeeded > 0
              ? 'Your messages are ready for review.'
              : 'Nothing landed in Approvals — make sure you ran "2. Assign Sequence" first.'),
          );
          if (succeeded > 0) {
            setNextCta({ href: '/approvals', label: 'Go to Approvals now' });
          }
          setSelected(new Set());
        }
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

    const n = selectedPartners.length;
    setLoading('assign');
    setNextCta(null);
    setMessage(`Sequencing ${n} prospect${n === 1 ? '' : 's'} now — assigning warm/cold templates and queuing steps…`);

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

      // Surface up to 3 skip reasons inline. The most common reasons we
      // hit are ICP-gate rejections ("Weighted score 1.4 below MIN_ICP_SCORE")
      // and out-of-scope category matches — the operator needs to see those
      // to understand why nothing got queued.
      const skipReasons = ((data.results || []) as Array<{ outcome: string; partner_name: string; reason?: string }>)
        .filter(r => r.outcome === 'skipped' && r.reason)
        .slice(0, 3)
        .map(r => `• ${r.partner_name}: ${r.reason}`);
      const reasonsBlock = skipReasons.length > 0
        ? `\n\nFirst ${skipReasons.length} of ${s.skipped} skips:\n${skipReasons.join('\n')}`
        : '';

      setMessage(
        `Sequenced ${s.assigned} of ${n} (${s.total_steps} step rows), ${s.skipped} skipped, ${s.errored} errored.` +
        (s.assigned > 0
          ? '\nSelection kept — click "3. Draft" to generate the first message now, or wait up to 15 min for the cron.'
          : '') +
        reasonsBlock,
      );
      // Selection kept so the operator can flow into Draft (step 3)
      // without re-ticking. router.refresh() pulls the updated server
      // state (in-flight badges, status changes) without dropping client
      // state.
      if (s.assigned > 0) {
        router.refresh();
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
        {runsForFilter.length > 0 && (
          <select
            value={runFilter}
            onChange={(e) => { setRunFilter(e.target.value); setSelected(new Set()); }}
            className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-300 focus:border-corp-green-500 focus:outline-none"
            title="Filter by discovery run — shows only prospects first surfaced by the chosen Find Investors run"
          >
            <option value="all">All runs</option>
            {runsForFilter.map(r => (
              <option key={r.id} value={r.id}>
                {r.run_code} · {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        )}
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
            title="Step 1 — Hunter.io email lookup for selected partners."
          >
            {loading === 'enrich' ? <Loader2 className="w-3 h-3 animate-spin" /> : '1. Enrich'}
          </button>
          <button
            onClick={batchAssignSequences}
            disabled={loading !== null}
            className="btn-secondary text-sm py-1 px-3 inline-flex items-center gap-1.5"
            title="Step 2 — Auto-routes: 1st-degree → warm DM sequence, others → cold sequence. Skips partners already on a sequence."
          >
            {loading === 'assign' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            2. Assign Sequence
          </button>
          <button
            onClick={() => batchAction('draft')}
            disabled={loading !== null}
            className="btn-primary text-sm py-1 px-3"
            title="Step 3 — Render the first sequence step for each selected partner so it lands in Approvals immediately. (Otherwise the cron renders it within 15 min.) Requires Step 2 to have run."
          >
            {loading === 'draft' ? <Loader2 className="w-3 h-3 animate-spin" /> : '3. Render & Queue'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-dark-500 text-sm hover:text-white ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Status message — preserve newlines so multi-line skip-reason blocks
          from assign-batch render properly. Three visual states:
          – loading: amber "doing X now" with spinner
          – success: green with optional CTA link to the next stage
          – error:   red. */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm whitespace-pre-line flex flex-wrap items-center gap-3 ${
            message.startsWith('Error')
              ? 'bg-red-500/10 text-red-400'
              : loading
                ? 'bg-amber-500/10 text-amber-300'
                : 'bg-corp-green-500/10 text-corp-green-400'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          <span className="flex-1">{message}</span>
          {!loading && nextCta && (
            <Link
              href={nextCta.href}
              className="btn-primary text-sm py-1 px-3 inline-flex items-center gap-1.5 shrink-0"
            >
              {nextCta.label}
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
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
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Prospect</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Role / Category</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Score</th>
                <th className="text-left text-dark-400 text-sm font-medium px-4 py-3">Reachability</th>
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
                    <Link href={`/partners/${p.id}`} className="flex items-start gap-3 hover:text-corp-green-400">
                      {(() => {
                        const isLinkedIn = p.source === 'linkedin' || p.source === 'sales_nav';
                        const display = getProspectDisplay(p);
                        // LinkedIn rows: person initial avatar (the firm logo would
                        // be misleading since their domain is the LinkedIn URL slug).
                        // Brave rows: real CompanyLogo, falling back to firm initial.
                        const avatarChar = (display.primary[0] || '?').toUpperCase();
                        return (
                          <>
                            {isLinkedIn || !p.domain || /\//.test(p.domain) ? (
                              <div className="w-6 h-6 bg-dark-700 rounded flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {avatarChar}
                              </div>
                            ) : (
                              <CompanyLogo domain={p.domain} companyName={p.company_name} size={24} />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">{display.primary}</span>
                                <SourceBadge partner={p} />
                                {p.first_seen_in_run_id && runsById[p.first_seen_in_run_id] && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-dark-800 text-dark-400 hover:bg-dark-700 cursor-pointer"
                                    title={`Discovered in run ${runsById[p.first_seen_in_run_id].run_code} on ${new Date(runsById[p.first_seen_in_run_id].created_at).toLocaleString()}. Click to filter list to this run only.`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setRunFilter(p.first_seen_in_run_id as string);
                                      setSelected(new Set());
                                    }}
                                  >
                                    {runsById[p.first_seen_in_run_id].run_code}
                                  </span>
                                )}
                              </div>
                              {display.subtitle && (
                                <div className="text-dark-500 text-xs truncate mt-0.5">{display.subtitle}</div>
                              )}
                            </div>
                          </>
                        );
                      })()}
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
                    {(() => {
                      const hasEmail = !!p.contact_email;
                      const hasLinkedIn = !!p.contact_linkedin;
                      if (!hasEmail && !hasLinkedIn) {
                        return <span className="text-dark-600">no contact</span>;
                      }
                      return (
                        <div className="space-y-0.5">
                          {hasEmail && (
                            <div className="text-dark-300 truncate" title={p.contact_email || ''}>
                              {p.contact_email}
                            </div>
                          )}
                          {hasLinkedIn && (
                            <div className="text-dark-500 text-xs">LinkedIn ↗</div>
                          )}
                        </div>
                      );
                    })()}
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
