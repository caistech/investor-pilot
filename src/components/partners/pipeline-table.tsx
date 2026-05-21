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
  // New tier between sent and replied — prospect accepted a value offer
  // (pilot, brief, intro) but hasn't booked a meeting yet. Higher
  // priority for the operator: nurture into a meeting, don't re-pitch
  // them like a cold prospect.
  { key: 'engaged', label: 'Warm engaged' },
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

function matchesFilter(status: string, filter: FilterKey, engagedAt?: string | null): boolean {
  if (filter === 'all') return true;
  if (filter === 'engaged') return !!engagedAt;
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

// Mirrors MAX_PARTNERS_PER_REQUEST in /api/sequences/render-now. The
// server runs 4-wide Claude calls; 8 partners = 2 chunks ≈ 32s inside
// Vercel's 60s ceiling. Bumping this requires bumping the server cap too.
const RENDER_NOW_MAX = 8;
// Enrich cap matches MAX_PARTNERS_PER_REQUEST in /api/pipeline/enrich/route.ts.
// Client chunks selection into batches of this size and runs them sequentially
// — operator sees one click ≈ "all selected enriched", not a flat error.
const ENRICH_MAX = 20;
// Re-enrich evidence runs LinkedIn deep-read + Brave per partner (much
// heavier than Hunter email lookup) — server cap is 10. Same client-side
// chunking pattern as Enrich + Render & Queue.
const REENRICH_MAX = 10;
// Reset is DB-only (no LLM, no external API) so the server cap is much
// higher — 50 per request — but for operator selections of 100+ we still
// need to chunk on the client. Same pattern as the heavier batch ops:
// operator clicks once, sees batch progress, never hits a flat "exceeds
// limit" wall. Server cap lives in src/app/api/sequences/reset/route.ts:32.
const RESET_MAX = 50;

/**
 * Translate skip reasons coming back from /api/sequences/assign-batch
 * into plain operator-facing English. The server's phrasing uses
 * internal terminology ("MIN_ICP_SCORE", "weighted_score", "out_of_scope
 * per v3 ICP") that doesn't read clearly. This helper pattern-matches
 * the most common reasons and rewrites them; anything unmatched falls
 * through verbatim so we never lose information.
 */
function humaniseSkipReason(raw: string): string {
  // ICP-score gate (post-2026-05-17: floor lowered to 2.0; anything that
  // hits this now is a genuine no-fit, not just "low confidence" — the
  // 2-4 band now flows through to Approvals as exploratory-tier drafts).
  const scoreMatch = raw.match(/Weighted score ([\d.]+) below MIN_ICP_SCORE \(([\d.]+)\)/);
  if (scoreMatch) {
    return `fit score ${scoreMatch[1]}/10 is below the ${scoreMatch[2]} floor — flagged as genuine no-fit during research, not worth sending to`;
  }
  // Out-of-scope category match
  if (/category is .*out[_ -]?of[_ -]?scope/i.test(raw)) {
    return `marked out-of-scope during research (different sector / stage / role than this project targets)`;
  }
  // Already on a sequence
  if (/Already has live steps on/i.test(raw)) {
    return raw.replace(/Already has live steps on "(.+?)"/, 'already on the "$1" sequence — skipped to avoid double-contact');
  }
  // No contact_name
  if (/No contact_name on partner/i.test(raw)) {
    return `missing the contact's name — can't address the message. Run "1. Find Emails" first or enrich via LinkedIn.`;
  }
  // No template
  if (/No (project|product)-side sequence template exists/i.test(raw)) {
    return raw; // server already wrote this one in plain English
  }
  return raw;
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

export interface OfferingOption {
  kind: 'product' | 'project';
  id: string;
  name: string;
}

export function PipelineTable({
  partners,
  organisationId,
  productId,
  inFlightPartnerIds = [],
  runsById = {},
  runsForFilter = [],
  offerings = [],
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
  // Every product + project belonging to the org. Drives the
  // Sales/Funding mode tabs + the "which offering" dropdown so the
  // operator can isolate a single product's or project's prospects.
  offerings?: OfferingOption[];
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
  // Sales (product-side prospects) vs Funding (project-side prospects).
  // Default 'all' so first-load matches existing behaviour.
  const [modeFilter, setModeFilter] = useState<'all' | 'sales' | 'funding'>('all');
  // Specific product/project filter. Values: 'all', 'product:<id>', 'project:<id>'.
  const [offeringFilter, setOfferingFilter] = useState<string>('all');
  // Quality filters — compose with status / source / type. Defaults are
  // conservative so the operator sees the full list on first load and
  // explicitly opts into trimming. Min score 0 = no floor; toggles default
  // off so historical data isn't hidden.
  const [minScore, setMinScore] = useState<number>(0);
  // Default ON (2026-05-17): out-of-scope prospects are noise by default —
  // the scorer judged them genuine wrong-category (e.g. an EdTech VC when
  // looking for property credit). Operator can untick to see them, and if
  // they explicitly select one, assign-batch now sends an exploratory-tier
  // draft rather than skipping outright.
  // Defaulted OFF 2026-05-19 — operator wants to see all rows on
  // first load. out_of_scope is now dropped at discovery anyway
  // (discover route hard-discards), so this checkbox is a legacy
  // safety net for rows pre-dating that rule. Operator can tick it
  // to narrow if they spot any.
  const [excludeOutOfScope, setExcludeOutOfScope] = useState<boolean>(false);
  const [hideLowConfidence, setHideLowConfidence] = useState<boolean>(false);
  // "Hide already targeted" = partner has been sent to (status moved
  // past contact_found) OR has an in-flight sequence_steps row.
  // Defaulted OFF 2026-05-19 — operator hit "12 of 49 shown" and
  // wanted to see all 49. The double-target guard now lives at the
  // assign-batch route level (skips partners with live steps with a
  // clear reason), so the UI doesn't need to hide them as a safety
  // net. Operator can tick the box to narrow when batch-planning.
  const [hideTargeted, setHideTargeted] = useState<boolean>(false);
  // Contact filter REMOVED 2026-05-19 — operator flagged it as
  // redundant with the source tabs. After the Brave-must-have-email
  // discovery rule, source IS reachability:
  //   Brave (web)        → has email (guaranteed by the discovery contract)
  //   LinkedIn 1st/2nd/cold → has a verified LinkedIn URL
  // No intermediate state survives discovery, so picking a source tab
  // already tells the operator which channel each row is on. Adding a
  // second filter on top was UX noise. Keep the variable as a no-op
  // constant so any downstream references don't need a sweep.
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Optional follow-up call-to-action shown beneath the status message —
  // e.g. after Draft completes, link the operator straight to /approvals
  // so there is no doubt about where the messages went.
  const [nextCta, setNextCta] = useState<{ href: string; label: string } | null>(null);
  const filtered = partners
    // 2026-05-19: removed the contact_name pre-filter that used to hide
    // any row without an extracted person. Operator flagged it was
    // opaque — "Brave 155/18, why can't I click on the 155 and run
    // Hunter on the missing 137?". Now every row is visible; the
    // operator picks an explicit Contact-status filter (below) to
    // narrow. Truly unactionable rows can be bulk-deleted via the
    // Recovery tools button, or bulk-enriched via "Find emails".
    .filter(p => matchesFilter(p.status, filter, p.engaged_at))
    .filter(p => matchesSourceTier(p, sourceFilter))
    // Contact filter REMOVED 2026-05-19 — source tabs replace it. See
    // comment near the (now-removed) ContactStatusKey type.
    .filter(p => matchesSearch(p, search))
    .filter(p => typeFilter === 'all' || p.partner_type === typeFilter)
    .filter(p => (p.weighted_score ?? 0) >= minScore)
    .filter(p => !excludeOutOfScope || !isOutOfScope(p))
    .filter(p => !hideLowConfidence || p.confidence_score !== 'low-confidence')
    .filter(p => !hideTargeted || !isAlreadyTargeted(p, inFlightSet))
    .filter(p => runFilter === 'all'
      || p.first_seen_in_run_id === runFilter
      || p.last_seen_in_run_id === runFilter)
    .filter(p => {
      if (modeFilter === 'sales') return !!p.product_id;
      if (modeFilter === 'funding') return !!p.project_id;
      return true;
    })
    .filter(p => {
      if (offeringFilter === 'all') return true;
      if (offeringFilter.startsWith('product:')) return p.product_id === offeringFilter.slice(8);
      if (offeringFilter.startsWith('project:')) return p.project_id === offeringFilter.slice(8);
      return true;
    });

  // Filter the offering dropdown to match the active mode (so "Sales"
  // mode doesn't show project options that would zero the list).
  const visibleOfferings = offerings.filter(o => {
    if (modeFilter === 'sales') return o.kind === 'product';
    if (modeFilter === 'funding') return o.kind === 'project';
    return true;
  });
  const selectedPartners = filtered.filter(p => selected.has(p.id));

  // Source-tier chip counts. Single honest number per chip; sums to All.
  // The previous "total / actionable" split was opaque — operator
  // flagged 2026-05-19: "what does Brave 155/18 mean to a first-time
  // user?". Now: one number, matches the All= count.
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
    const allIds = selectedPartners.map(p => p.id);
    const n = allIds.length;

    // Auto-chunk per the per-action server cap so the operator can click
    // ONE button on a 50-prospect selection and have all 50 processed.
    // Each batch is a separate API call, max chunkSize partners; we run
    // them sequentially so each one finishes inside Vercel's 60s ceiling
    // before the next starts. The user-facing message updates per batch
    // ("Batch 2 of 3 — processed 40/54…") so progress is visible.
    //
    // Was: blocked the click with "trim selection" if n > cap. New
    // behaviour matches the operator's mental model — one click = "do
    // it to all selected".
    const chunkSize = action === 'enrich' ? ENRICH_MAX : RENDER_NOW_MAX;
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += chunkSize) {
      chunks.push(allIds.slice(i, i + chunkSize));
    }

    const endpoint = action === 'enrich'
      ? '/api/pipeline/enrich'
      : '/api/sequences/render-now';

    setLoading(action);
    setNextCta(null);

    // Aggregated totals across all batches.
    let totalSucceeded = 0;
    let totalErrored = 0;
    let totalSkipped = 0;
    let totalNoEmails = 0;
    let totalAlreadyDone = 0;
    // Per-category render-now totals so the final summary can name every
    // bucket the batches landed in. Previously the aggregator collapsed
    // "blocked + failed" into totalErrored and showed only the last
    // batch's hint, which meant a 4-batch run with 24 previously-skipped
    // prospects + 2 compliance-blocked surfaced as "2 blocked by compliance
    // regex" — losing 22 of 26 from the summary. Operator was left
    // wondering what happened.
    const renderTotals = {
      queued: 0,
      blocked: 0,
      failed: 0,
      skipped_no_channel: 0,
      sent_or_replied: 0,
      no_pending_step: 0,
      previously_skipped: 0,
      already_rendered: 0,
    };
    const errorMessages: string[] = [];
    // Render-now per-batch hint — kept for batches that report something
    // the per-category totals can't (e.g. a first-batch failure reason).
    // Final summary prefers the totals-driven message.
    let lastRenderHint = '';

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const batchLabel = chunks.length > 1
          ? `Batch ${i + 1} of ${chunks.length} (${chunk.length} prospects) — `
          : '';
        setMessage(
          action === 'enrich'
            ? `${batchLabel}looking up email addresses via Hunter.io… ${totalSucceeded + totalErrored + totalSkipped} of ${n} prospect${n === 1 ? '' : 's'} checked so far.`
            : `${batchLabel}writing the first message for each prospect… ${totalSucceeded} of ${n} ready in Approvals so far.`,
        );

        const body = action === 'enrich'
          ? { partner_ids: chunk, organisation_id: organisationId }
          : { partner_ids: chunk };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        // Defensive parse — Vercel sometimes returns an HTML error page on
        // timeouts / runtime crashes / 504s. Plain await res.json() throws
        // "Unexpected token 'A'" and the operator gets a useless message.
        const rawBody = await res.text();
        let data: { [k: string]: unknown };
        try {
          data = JSON.parse(rawBody);
        } catch {
          errorMessages.push(
            `Batch ${i + 1}: server didn't respond properly (HTTP ${res.status} ${res.statusText} — usually a timeout). Try the same batch again in a minute.`,
          );
          totalErrored += chunk.length;
          continue;
        }

        if (!res.ok) {
          errorMessages.push(`Batch ${i + 1}: ${(data.error as string) || `server returned ${res.status} ${res.statusText}`}`);
          totalErrored += chunk.length;
          continue;
        }

        if (action === 'enrich') {
          totalSucceeded += (data.enriched as number) || 0;
          totalErrored += (data.errors as number) || 0;
          totalSkipped += (data.skipped as number) || (data.unresolved as number) || 0;
          totalNoEmails += (data.no_emails as number) || 0;
        } else {
          const counts = (data.counts as Record<string, number>) || {};
          totalSucceeded += counts.queued || 0;
          totalErrored += (counts.failed || 0) + (counts.blocked || 0);
          totalSkipped += (counts.skipped_no_channel || 0) + (counts.no_pending_step || 0) + (counts.previously_skipped || 0);
          totalAlreadyDone += counts.already_rendered || 0;
          renderTotals.queued += counts.queued || 0;
          renderTotals.blocked += counts.blocked || 0;
          renderTotals.failed += counts.failed || 0;
          renderTotals.skipped_no_channel += counts.skipped_no_channel || 0;
          renderTotals.sent_or_replied += counts.sent_or_replied || 0;
          renderTotals.no_pending_step += counts.no_pending_step || 0;
          renderTotals.previously_skipped += counts.previously_skipped || 0;
          renderTotals.already_rendered += counts.already_rendered || 0;
          if (typeof data.hint === 'string') lastRenderHint = data.hint;
        }
      }

      // Re-fetch server state so badges / status columns reflect the
      // newly-enriched or newly-queued rows. Selection survives.
      if (totalSucceeded > 0) {
        router.refresh();
      }

      const errorTrailer = errorMessages.length > 0
        ? `\n\nThere ${errorMessages.length === 1 ? 'was 1 problem' : `were ${errorMessages.length} problems`} during this run:\n• ${errorMessages.slice(0, 3).join('\n• ')}${errorMessages.length > 3 ? `\n• …and ${errorMessages.length - 3} more` : ''}`
        : '';

      if (action === 'enrich') {
        // Honest breakdown across all four buckets returned by the
        // cascade. The earlier copy ("X had no public business email")
        // conflated skipped-no-real-domain with cascade-misses, making
        // the operator think Hunter/Apollo were broken when most of the
        // 84/85 were never even queried (LinkedIn pseudo-domains get
        // filtered out at /api/partners/bulk-hunter eligible step).
        const parts: string[] = [];
        if (totalSucceeded > 0) {
          parts.push(`Found emails for ${totalSucceeded} of ${n}.`);
        }
        if (totalNoEmails > 0) {
          parts.push(`${totalNoEmails} had a real company domain but Hunter+Apollo returned no public email — typically AU SMEs or small private firms outside their crawl coverage.`);
        }
        if (totalSkipped > 0) {
          parts.push(`${totalSkipped} skipped — LinkedIn-only profiles with no resolved company domain (the cascade needs a real domain to query).`);
        }
        if (totalErrored > 0) {
          parts.push(`${totalErrored} hit lookup errors.`);
        }
        const headline = totalSucceeded === 0
          ? `Looked up ${n} prospect${n === 1 ? '' : 's'} — no emails found.`
          : totalSucceeded === n
            ? `Found emails for all ${n} prospect${n === 1 ? '' : 's'}.`
            : parts.join(' ');
        const nextStepHint = totalSucceeded > 0
          ? 'Selection kept — click "2. Plan Outreach" next.'
          : totalSkipped > 0 && totalNoEmails === 0
            ? 'These are LinkedIn-only profiles — Hunter+Apollo can\'t reach them without a company domain. For LinkedIn DM outreach (no email needed), click "Refresh research" then "2. Plan Outreach".'
            : 'Hunter+Apollo coverage skews to US + larger firms. For AU SMEs, expect low hit rates — use LinkedIn DM via "Refresh research" → "2. Plan Outreach", or pivot discovery toward US-based prospects.';
        setMessage(
          `${headline}${chunks.length > 1 ? ` (Ran in ${chunks.length} batches of up to ${chunkSize} per Hunter API call.)` : ''}\n${nextStepHint}${errorTrailer}`,
        );
      } else {
        // Render-now (Draft Messages Now). Headline in plain English.
        // Hint is built from per-category totals so a 4-batch run
        // reports the full picture instead of just the last batch.
        const draftWord = (count: number) => `${count} draft${count === 1 ? '' : 's'}`;
        const headline = totalSucceeded === 0 && totalAlreadyDone === 0
          ? `Couldn't write any messages for the ${n} selected prospect${n === 1 ? '' : 's'}.`
          : totalSucceeded === 0 && totalAlreadyDone > 0
            ? `${draftWord(totalAlreadyDone)} were already in Approvals — nothing new to write.`
            : totalAlreadyDone === 0
              ? `Wrote ${draftWord(totalSucceeded)} and sent to Approvals (out of ${n} selected).`
              : `Wrote ${draftWord(totalSucceeded)} and sent to Approvals. ${totalAlreadyDone} more were already there.`;

        // Build the aggregated summary from totals. Every non-zero
        // category gets a line so the operator can see exactly where
        // every selected prospect landed. Order = highest-priority
        // remediation first.
        const summaryParts: string[] = [];
        if (renderTotals.previously_skipped > 0) {
          summaryParts.push(`${renderTotals.previously_skipped} have skipped drafts (likely from a bulk-clear) — click "2. Plan Outreach" to re-assign fresh sequences against the current active template before re-rendering.`);
        }
        if (renderTotals.no_pending_step > 0) {
          summaryParts.push(`${renderTotals.no_pending_step} have no sequence assigned — click "2. Plan Outreach" first.`);
        }
        if (renderTotals.blocked > 0) {
          summaryParts.push(`${renderTotals.blocked} blocked by compliance — open prospect detail to see the flagged terms.`);
        }
        if (renderTotals.failed > 0) {
          summaryParts.push(`${renderTotals.failed} failed — open prospect detail for the per-step error trail.`);
        }
        if (renderTotals.skipped_no_channel > 0) {
          summaryParts.push(`${renderTotals.skipped_no_channel} skipped — Step 1 needs an active LinkedIn channel. Connect one in /channels.`);
        }
        if (renderTotals.sent_or_replied > 0) {
          summaryParts.push(`${renderTotals.sent_or_replied} already sent or replied (historical).`);
        }
        if (renderTotals.already_rendered > 0 && totalSucceeded === 0) {
          summaryParts.push(`${renderTotals.already_rendered} already rendered — check Approvals.`);
        }
        const aggregateHint = summaryParts.length > 0
          ? summaryParts.join(' ')
          : lastRenderHint;

        setMessage(
          `${headline}${chunks.length > 1 ? ` (Ran in ${chunks.length} batches of up to ${chunkSize} prospects per Claude run.)` : ''}\n${aggregateHint}${errorTrailer}`,
        );
        if (totalSucceeded > 0 || totalAlreadyDone > 0) {
          setNextCta({ href: '/approvals', label: 'Go to Approvals now' });
        }
        setSelected(new Set());
      }
    } catch (err) {
      setMessage(`Couldn't finish the request: ${err instanceof Error ? err.message : String(err)}. Try again — if it keeps failing, the system or your network may be having a moment.`);
    } finally {
      setLoading(null);
    }
  }

  async function reEnrichEvidence() {
    if (selectedPartners.length === 0) return;
    const allIds = selectedPartners.map(p => p.id);
    const n = allIds.length;

    // Auto-chunk by REENRICH_MAX. Each batch is one call (LinkedIn deep-read
    // + Brave per partner = ~30-50s wall), runs sequentially. One click =
    // all selected re-enriched, regardless of count. Same pattern as
    // batchAction — operator never sees a "trim selection" wall.
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += REENRICH_MAX) {
      chunks.push(allIds.slice(i, i + REENRICH_MAX));
    }

    setLoading('reenrich');
    setNextCta(null);

    let totalEnriched = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const errorMessages: string[] = [];

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const batchLabel = chunks.length > 1
          ? `Batch ${i + 1} of ${chunks.length} (${chunk.length} prospects) — `
          : '';
        setMessage(
          `${batchLabel}researching prospects now — pulling firm news from Brave web search + recent posts from LinkedIn… ${totalEnriched + totalSkipped + totalFailed} of ${n} done so far.`,
        );

        const res = await fetch('/api/partners/re-enrich-evidence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partner_ids: chunk }),
        });
        const rawBody = await res.text();
        let data: { [k: string]: unknown };
        try { data = JSON.parse(rawBody); } catch {
          errorMessages.push(`Batch ${i + 1}: server didn't respond properly (HTTP ${res.status} — usually a timeout). Try again in a minute.`);
          totalFailed += chunk.length;
          continue;
        }
        if (!res.ok) {
          errorMessages.push(`Batch ${i + 1}: ${(data.error as string) || `server returned ${res.status} ${res.statusText}`}`);
          totalFailed += chunk.length;
          continue;
        }
        totalEnriched += (data.enriched as number) || 0;
        totalSkipped += (data.skipped as number) || 0;
        totalFailed += (data.failed as number) || 0;
      }

      const errorTrailer = errorMessages.length > 0
        ? `\n\nThere ${errorMessages.length === 1 ? 'was 1 problem' : `were ${errorMessages.length} problems`} during this run:\n• ${errorMessages.slice(0, 3).join('\n• ')}${errorMessages.length > 3 ? `\n• …and ${errorMessages.length - 3} more` : ''}`
        : '';

      const headline = totalEnriched === 0
        ? `Couldn't refresh research for any of the ${n} selected prospect${n === 1 ? '' : 's'}.`
        : totalEnriched === n
          ? `Refreshed research on all ${n} prospect${n === 1 ? '' : 's'}.`
          : `Refreshed research on ${totalEnriched} of ${n} prospects. ${n - totalEnriched} ${n - totalEnriched === 1 ? 'was' : 'were'} skipped or failed (${totalSkipped} had no LinkedIn URL or other lookup path, ${totalFailed} hit an error).`;
      setMessage(
        `${headline}${chunks.length > 1 ? ` (Ran in ${chunks.length} batches of up to ${REENRICH_MAX} prospects per pass.)` : ''}\n` +
        (totalEnriched > 0
          ? 'Selection kept — now click "Restart plan" → "2. Plan Outreach" → "3. Draft Messages Now" to write fresh drafts using the new research.'
          : 'Nothing was refreshed — these prospects need either a LinkedIn URL or a discoverable company website for research to work.') +
        errorTrailer,
      );
      router.refresh();
    } catch (err) {
      setMessage(`Couldn't finish the request: ${err instanceof Error ? err.message : String(err)}. Try again — if it keeps failing, the system or your network may be having a moment.`);
    } finally {
      setLoading(null);
    }
  }

  async function resetSequences() {
    if (selectedPartners.length === 0) return;
    const allIds = selectedPartners.map(p => p.id);
    const n = allIds.length;
    const confirmMsg = `Restart the outreach plan for ${n} prospect${n === 1 ? '' : 's'}?\n\n` +
      `This clears the current template assignment and removes any queued or blocked drafts. ` +
      `Messages you've already sent — and any replies you've received — stay in your history. ` +
      `Use this when you assigned the wrong template (e.g. a sales sequence got picked instead of an investor one) and want to redo Plan Outreach cleanly.`;
    if (!confirm(confirmMsg)) return;

    // Auto-chunk by RESET_MAX. Server caps each request at 50 partners
    // (DB-only operation but bounded for safety). Same client-side
    // chunking pattern as reEnrichEvidence / batchAction — operator
    // clicks once, sees batch progress, never hits a flat "exceeds limit"
    // wall. Without this chunking, selecting >50 prospects and clicking
    // Restart plan returned a 400 with the server's "Batch size N exceeds
    // limit 50" error and the operator had to manually trim selection.
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += RESET_MAX) {
      chunks.push(allIds.slice(i, i + RESET_MAX));
    }

    setLoading('reset');
    setNextCta(null);

    let totalPartnersReset = 0;
    let totalStepsDeleted = 0;
    let totalDraftsDeleted = 0;
    const errorMessages: string[] = [];

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const batchLabel = chunks.length > 1
          ? `Batch ${i + 1} of ${chunks.length} (${chunk.length} prospects) — `
          : '';
        setMessage(`${batchLabel}restarting the outreach plan… ${totalPartnersReset} of ${n} done so far.`);

        const res = await fetch('/api/sequences/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partner_ids: chunk }),
        });
        const rawBody = await res.text();
        let data: { [k: string]: unknown };
        try { data = JSON.parse(rawBody); } catch {
          errorMessages.push(`Batch ${i + 1}: server didn't respond properly (HTTP ${res.status} — usually a timeout). Try again in a minute.`);
          continue;
        }
        if (!res.ok) {
          errorMessages.push(`Batch ${i + 1}: ${(data.error as string) || `server returned ${res.status} ${res.statusText}`}`);
          continue;
        }
        totalPartnersReset += (data.partners_reset as number) || 0;
        totalStepsDeleted += (data.steps_deleted as number) || 0;
        totalDraftsDeleted += (data.messages_deleted as number) || 0;
      }

      const errorTrailer = errorMessages.length > 0
        ? `\n\nThere ${errorMessages.length === 1 ? 'was 1 problem' : `were ${errorMessages.length} problems`} during this run:\n• ${errorMessages.slice(0, 3).join('\n• ')}${errorMessages.length > 3 ? `\n• …and ${errorMessages.length - 3} more` : ''}`
        : '';

      setMessage(
        `Cleared the plan for ${totalPartnersReset} prospect${totalPartnersReset === 1 ? '' : 's'}. ` +
        `Removed ${totalStepsDeleted} scheduled step${totalStepsDeleted === 1 ? '' : 's'}` +
        (totalDraftsDeleted > 0 ? ` and ${totalDraftsDeleted} queued draft${totalDraftsDeleted === 1 ? '' : 's'}` : '') +
        `. Sent and replied messages are untouched.` +
        (chunks.length > 1 ? ` (Ran in ${chunks.length} batches of up to ${RESET_MAX} prospects per pass.)` : '') +
        `\nSelection kept — click "2. Plan Outreach" to assign a fresh template.` +
        errorTrailer,
      );
      router.refresh();
    } catch (err) {
      setMessage(`Couldn't restart the plan: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  }

  async function bulkFindEmails() {
    if (selectedPartners.length === 0) return;
    const n = selectedPartners.length;
    // Hunter is the right tool for COMPANY-only rows (no contact yet).
    // If the selection includes rows that already have emails, the server
    // will skip them — but we warn here so the operator's mental model
    // matches what'll happen.
    const noEmailCount = selectedPartners.filter(p => !p.contact_email).length;
    if (noEmailCount === 0) {
      setMessage('All selected rows already have an email — nothing to enrich. Pick rows from the "Company only" or "Has LinkedIn only" filter.');
      return;
    }
    const skipCount = n - noEmailCount;
    const confirmMsg = `Find emails for ${noEmailCount} prospect${noEmailCount === 1 ? '' : 's'} via Hunter.io?\n\n` +
      (skipCount > 0 ? `(${skipCount} of your ${n} selected already have an email — those will be skipped.)\n\n` : '') +
      `Each lookup costs ~$0.04 — total ~$${(noEmailCount * 0.04).toFixed(2)}. Rows that return a verified contact will land as 'contact_found' and become actionable in the table.`;
    if (!confirm(confirmMsg)) return;

    setLoading('find_emails');
    setNextCta(null);
    setMessage(`Running Hunter on ${noEmailCount} prospect${noEmailCount === 1 ? '' : 's'}…`);
    try {
      const res = await fetch('/api/partners/bulk-hunter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_ids: selectedPartners.map(p => p.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error || 'hunter lookup failed'}`);
        return;
      }
      const enriched = data.enriched ?? 0;
      const noEmails = data.no_emails ?? 0;
      const errors = data.errors ?? 0;
      setMessage(
        `Hunter finished. Enriched: ${enriched}. No email found: ${noEmails}. Errors: ${errors}. ` +
        `Refresh the page to see updated rows — or filter to "Has email + name" to see the ones now actionable.`,
      );
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  }

  async function bulkDelete() {
    if (selectedPartners.length === 0) return;
    const n = selectedPartners.length;
    const sample = selectedPartners.slice(0, 3).map(p => `${p.contact_name || p.company_name}`).join(', ');
    const more = n > 3 ? ` and ${n - 3} more` : '';
    const confirmMsg = `PERMANENTLY DELETE ${n} prospect${n === 1 ? '' : 's'}?\n\n` +
      `${sample}${more}\n\n` +
      `This removes the partner row + any associated sequence_steps + outbound_messages (FK cascade). No recovery. Type-check the selection before confirming.`;
    if (!confirm(confirmMsg)) return;

    setLoading('delete');
    setNextCta(null);
    setMessage(`Deleting ${n} prospect${n === 1 ? '' : 's'}…`);
    try {
      const res = await fetch('/api/partners/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_ids: selectedPartners.map(p => p.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error || 'delete failed'}`);
        return;
      }
      setMessage(`Deleted ${data.deleted ?? n} prospect${(data.deleted ?? n) === 1 ? '' : 's'}. Refresh to see the table update.`);
      setSelected(new Set());
      router.refresh();
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

    // Auto-Hunter: identify rows that need email lookup before they can
    // be planned. "Needs Hunter" = no contact_email yet AND we have a
    // REAL company domain to try (NOT a LinkedIn pseudo-domain — Hunter
    // can't search those and rejects them). Skipping LI pseudo-domains
    // here saves the Hunter API call entirely; the row stays in the
    // selection and either has a verified LinkedIn (kept) or doesn't
    // (auto-deleted in phase 1.5).
    const needsHunter = selectedPartners.filter(p => {
      const hasEmail = typeof p.contact_email === 'string' && p.contact_email.trim().length > 0;
      if (hasEmail) return false;
      const domainStr = typeof p.domain === 'string' ? p.domain.trim() : '';
      if (!domainStr) return false;
      if (/^linkedin\.com\//i.test(domainStr) || domainStr.includes('/')) return false;
      return true;
    });
    const hunterIds = needsHunter.map(p => p.id);

    const confirmMsg = `Plan outreach for ${selectedPartners.length} prospect${selectedPartners.length === 1 ? '' : 's'}?\n\n` +
      `  • ${firstDegreeCount} 1st-degree LinkedIn connection${firstDegreeCount === 1 ? '' : 's'} → warm sequence (3 messages over 9 days)\n` +
      `  • ${otherCount} other prospect${otherCount === 1 ? '' : 's'} → cold sequence (6 messages over 14 days, with personalised research per recipient)\n` +
      (hunterIds.length > 0
        ? `  • ${hunterIds.length} need an email lookup first — Hunter will run automatically before scheduling.\n`
        : '') +
      `\nDrafts then render into Approvals as the cron picks them up (a few minutes for the first batch, then ongoing). Sending happens at your channel caps over the following days — you don't need to babysit it.\n\n` +
      `Prospects already on a sequence will be left alone. Out-of-scope prospects are refused.`;
    if (!confirm(confirmMsg)) return;

    const n = selectedPartners.length;
    setLoading('assign');
    setNextCta(null);

    // PHASE 1: Auto-Hunter on missing-email rows. Chunked at ENRICH_MAX
    // so an operator selecting 200+ doesn't hit the server's per-request
    // cap. Failures are non-fatal — Hunter often doesn't find a real
    // email and the row stays unactionable, which assign-batch will
    // then surface as 'skipped — no email'.
    let hunterFoundEmails = 0;
    const hunterFoundIds = new Set<string>();
    if (hunterIds.length > 0) {
      setMessage(`Running Hunter on ${hunterIds.length} prospect${hunterIds.length === 1 ? '' : 's'} missing email addresses… (then will plan outreach for all ${n})`);
      const huntChunks: string[][] = [];
      for (let i = 0; i < hunterIds.length; i += ENRICH_MAX) {
        huntChunks.push(hunterIds.slice(i, i + ENRICH_MAX));
      }
      for (let i = 0; i < huntChunks.length; i += 1) {
        const chunk = huntChunks[i];
        try {
          const hRes = await fetch('/api/pipeline/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ partner_ids: chunk, organisation_id: organisationId }),
          });
          const hBody = await hRes.text();
          let hData: { [k: string]: unknown } = {};
          try { hData = JSON.parse(hBody); } catch { /* ignore */ }
          if (hRes.ok) {
            hunterFoundEmails += (hData.enriched as number) || 0;
            const results = (hData.results as Array<{ partner_id: string; status: string }>) || [];
            for (const r of results) {
              if (r.status === 'enriched') hunterFoundIds.add(r.partner_id);
            }
          }
        } catch { /* non-fatal — row will be auto-deleted below if it ends up unactionable */ }
        if (huntChunks.length > 1) {
          setMessage(`Hunter batch ${i + 1} of ${huntChunks.length} done — ${hunterFoundEmails} email${hunterFoundEmails === 1 ? '' : 's'} found so far…`);
        }
      }
      router.refresh();
    }

    // PHASE 1.5: Auto-delete unactionable rows. Operator rule 2026-05-19:
    // "If they have no findable LinkedIn and no findable email after
    // Hunter — delete them. They will never be any good so why clutter
    // up our database." A row is unactionable when:
    //   - it has no contact_email AND wasn't enriched by Hunter just now
    //   - AND it has no verified LinkedIn (source must be linkedin /
    //     sales_nav for the LI URL to count; Brave-guessed handles
    //     don't, per the 2026-05-19 channel-routing rule)
    const unactionableIds = selectedPartners
      .filter(p => {
        const hadEmail = typeof p.contact_email === 'string' && p.contact_email.trim().length > 0;
        const gotEmailJustNow = hunterFoundIds.has(p.id);
        if (hadEmail || gotEmailJustNow) return false;
        const liSourced = p.source === 'linkedin' || p.source === 'sales_nav';
        const hasLi = typeof p.contact_linkedin === 'string' && p.contact_linkedin.trim().length > 0;
        return !(liSourced && hasLi);
      })
      .map(p => p.id);

    let autoDeletedCount = 0;
    if (unactionableIds.length > 0) {
      setMessage(`Auto-deleting ${unactionableIds.length} prospect${unactionableIds.length === 1 ? '' : 's'} with no email + no verified LinkedIn (unactionable — never going to convert)…`);
      try {
        const dRes = await fetch('/api/partners/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partner_ids: unactionableIds }),
        });
        if (dRes.ok) {
          const dData = await dRes.json();
          autoDeletedCount = (dData.deleted as number) || unactionableIds.length;
        }
      } catch { /* non-fatal — they'll still get skipped at assign-batch */ }
      router.refresh();
    }

    const survivingIds = selectedPartners.map(p => p.id).filter(id => !unactionableIds.includes(id));
    const n2 = survivingIds.length;
    if (n2 === 0) {
      setMessage(
        `Nothing to plan. All ${n} selected prospect${n === 1 ? '' : 's'} were unactionable (no email Hunter could find, no verified LinkedIn) — auto-deleted.` +
        (hunterFoundEmails > 0 ? ` Hunter found ${hunterFoundEmails} email${hunterFoundEmails === 1 ? '' : 's'} but those rows still lacked a route.` : '')
      );
      setSelected(new Set());
      router.refresh();
      setLoading(null);
      return;
    }

    setMessage(`Planning outreach for ${n2} prospect${n2 === 1 ? '' : 's'}${hunterIds.length > 0 ? ` (${hunterFoundEmails} new emails from Hunter, ${autoDeletedCount} unactionable rows deleted)` : ''}…`);

    // PHASE 2: assign-batch, client-side chunked at 100. Server cap
    // also at 500 (raised 2026-05-19) — chunking lets the operator
    // select 500+ in one click without hitting a wall.
    const ASSIGN_MAX = 100;
    const assignChunks: string[][] = [];
    for (let i = 0; i < survivingIds.length; i += ASSIGN_MAX) {
      assignChunks.push(survivingIds.slice(i, i + ASSIGN_MAX));
    }

    let totalAssigned = 0;
    let totalSkipped = 0;
    let totalErrored = 0;
    let totalSteps = 0;
    const allResults: Array<{ outcome: string; partner_name: string; reason?: string }> = [];

    try {
      for (let i = 0; i < assignChunks.length; i += 1) {
        const chunk = assignChunks[i];
        if (assignChunks.length > 1) {
          setMessage(`Planning outreach — batch ${i + 1} of ${assignChunks.length} (${chunk.length} prospects, ${totalAssigned} assigned so far)…`);
        }
        const res = await fetch('/api/sequences/assign-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partner_ids: chunk }),
        });
        const rawBody = await res.text();
        let data: { [k: string]: unknown };
        try { data = JSON.parse(rawBody); } catch {
          setMessage(`Server returned a non-JSON response on batch ${i + 1} (HTTP ${res.status}). ${totalAssigned} prospects already assigned. Try the remaining selection again.`);
          return;
        }
        if (!res.ok) {
          setMessage(`Couldn't plan outreach on batch ${i + 1}: ${(data.error as string) || `server returned ${res.status} ${res.statusText}`}. ${totalAssigned} already assigned.`);
          return;
        }
        const s = (data.summary as { assigned: number; skipped: number; errored: number; total_steps: number }) || { assigned: 0, skipped: 0, errored: 0, total_steps: 0 };
        totalAssigned += s.assigned;
        totalSkipped += s.skipped;
        totalErrored += s.errored;
        totalSteps += s.total_steps;
        const results = (data.results as Array<{ outcome: string; partner_name: string; reason?: string }>) || [];
        allResults.push(...results);
      }

      const data = { summary: { assigned: totalAssigned, skipped: totalSkipped, errored: totalErrored, total_steps: totalSteps }, results: allResults };
      const s = data.summary;

      // Surface up to 3 skip reasons inline, translated from the
      // server's technical phrasing to plain English. Most common
      // reasons: ICP-gate rejections (low weighted_score) and
      // out_of_scope category matches.
      const skipReasons = ((data.results || []) as Array<{ outcome: string; partner_name: string; reason?: string }>)
        .filter(r => r.outcome === 'skipped' && r.reason)
        .slice(0, 3)
        .map(r => `• ${r.partner_name} — ${humaniseSkipReason(r.reason!)}`);
      const reasonsBlock = skipReasons.length > 0
        ? `\n\nWhy ${s.skipped} ${s.skipped === 1 ? 'was' : 'were'} skipped (showing first ${skipReasons.length}):\n${skipReasons.join('\n')}`
        : '';

      // Researcher rule: when 0 assigned and skips look like "low ICP /
      // out_of_scope", the operator is usually selecting the WRONG group
      // — better-fit candidates live in a different tab or behind a
      // search box filter. Surface that proactively instead of letting
      // them re-hit the same dead end. Scope: same offering as the
      // operator's current filter (or any if no offering filter active),
      // weighted_score >= 4, not in current selection, not already
      // assigned via another live sequence step.
      let betterHint = '';
      if (s.assigned === 0 && s.skipped > 0) {
        const selectedIds = new Set(selectedPartners.map(p => p.id));
        // offeringFilter is 'all' | 'project:<uuid>' | 'product:<uuid>'.
        // When narrowed, only count candidates on the same offering — the
        // operator chose that scope deliberately, and surfacing prospects
        // from a different project would just confuse them.
        const offeringScope = offeringFilter.startsWith('project:')
          ? { kind: 'project' as const, id: offeringFilter.slice(8) }
          : offeringFilter.startsWith('product:')
            ? { kind: 'product' as const, id: offeringFilter.slice(8) }
            : null;
        const candidates = partners.filter(p => {
          if (selectedIds.has(p.id)) return false;
          if ((p.weighted_score ?? 0) < 4) return false;
          if (typeof p.category === 'string' && /out[_ -]?of[_ -]?scope/i.test(p.category)) return false;
          if (offeringScope) {
            const offeringId = offeringScope.kind === 'project' ? p.project_id : p.product_id;
            if (offeringId !== offeringScope.id) return false;
          }
          return true;
        });

        if (candidates.length > 0) {
          const topThree = candidates
            .slice()
            .sort((a, b) => (b.weighted_score ?? 0) - (a.weighted_score ?? 0))
            .slice(0, 3)
            .map(c => `${c.company_name || c.contact_name || 'unnamed'} (${(c.weighted_score ?? 0).toFixed(1)})`);
          betterHint =
            `\n\n💡 ${candidates.length} higher-fit prospect${candidates.length === 1 ? '' : 's'} for this offering exist outside your current selection. ` +
            `Top: ${topThree.join(', ')}. ` +
            `Clear the search box, untick filters, or switch to a different source tab (1st/2nd-degree, Brave) to find them.`;
        }
      }

      const deletedSuffix = autoDeletedCount > 0
        ? ` (${autoDeletedCount} unactionable row${autoDeletedCount === 1 ? '' : 's'} also auto-deleted)`
        : '';
      const hunterSuffix = hunterFoundEmails > 0
        ? ` Hunter found ${hunterFoundEmails} new email${hunterFoundEmails === 1 ? '' : 's'} along the way.`
        : '';
      const headline = s.assigned === 0
        ? `Couldn't plan outreach for any of the ${n2} prospect${n2 === 1 ? '' : 's'} that made it through — ${s.skipped} skipped, ${s.errored} hit errors${deletedSuffix}.${hunterSuffix}`
        : s.assigned === n2
          ? `Planned outreach for all ${n2} prospect${n2 === 1 ? '' : 's'} (${s.total_steps} message${s.total_steps === 1 ? '' : 's'} scheduled across the sequences)${deletedSuffix}.${hunterSuffix}`
          : `Planned outreach for ${s.assigned} of ${n2} prospects (${s.total_steps} scheduled messages). ${s.skipped} skipped${s.errored > 0 ? `, ${s.errored} hit errors` : ''}${deletedSuffix}.${hunterSuffix}`;
      setMessage(
        `${headline}` +
        (s.assigned > 0
          ? '\n\nDrafts will render into Approvals over the next few minutes via the background cron. Sending happens automatically at your channel daily caps — you don\'t need to babysit this.'
          : '') +
        reasonsBlock +
        betterHint,
      );
      // Selection kept so the operator can flow into Draft (step 3)
      // without re-ticking. router.refresh() pulls the updated server
      // state (in-flight badges, status changes) without dropping client
      // state.
      if (s.assigned > 0) {
        router.refresh();
      }
    } catch (err) {
      setMessage(`Couldn't finish the request: ${err instanceof Error ? err.message : String(err)}. Try again — if it keeps failing, the system or your network may be having a moment.`);
    } finally {
      setLoading(null);
    }
  }

  const counts = {
    all: partners.length,
    scored: partners.filter(p => matchesFilter(p.status, 'scored', p.engaged_at)).length,
    enriched: partners.filter(p => matchesFilter(p.status, 'enriched', p.engaged_at)).length,
    drafted: partners.filter(p => matchesFilter(p.status, 'drafted', p.engaged_at)).length,
    sent: partners.filter(p => matchesFilter(p.status, 'sent', p.engaged_at)).length,
    replied: partners.filter(p => matchesFilter(p.status, 'replied', p.engaged_at)).length,
    engaged: partners.filter(p => !!p.engaged_at).length,
  };

  return (
    <div>
      {/* Search + type filter */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
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
            title="Filter by discovery run — shows only prospects first surfaced by the chosen discovery run"
          >
            <option value="all">All runs</option>
            {runsForFilter.map(r => (
              <option key={r.id} value={r.id}>
                {r.run_code} · {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        )}
        {/* Sales / Funding mode toggle — sales = prospects discovered for
            a product, funding = prospects discovered for a project. Mirrors
            the Products (Sales) / Projects (Funding) split in the sidebar. */}
        {offerings.length > 0 && (
          <select
            value={modeFilter}
            onChange={(e) => {
              const next = e.target.value as 'all' | 'sales' | 'funding';
              setModeFilter(next);
              // Reset the offering filter when mode changes — otherwise a
              // stale "project:<id>" filter persists while user is on
              // 'sales' mode and zeros the list.
              setOfferingFilter('all');
              setSelected(new Set());
            }}
            className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-300 focus:border-corp-green-500 focus:outline-none"
            title="Filter by Sales (product-side prospects) or Funding (project-side prospects)"
          >
            <option value="all">All modes</option>
            <option value="sales">Sales (Products)</option>
            <option value="funding">Funding (Projects)</option>
          </select>
        )}
        {/* Specific product or project. Only rendered when there are
            options under the current mode so the dropdown is never empty. */}
        {visibleOfferings.length > 0 && (
          <select
            value={offeringFilter}
            onChange={(e) => { setOfferingFilter(e.target.value); setSelected(new Set()); }}
            className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-300 focus:border-corp-green-500 focus:outline-none"
            title="Filter by a specific product or project"
          >
            <option value="all">All {modeFilter === 'sales' ? 'products' : modeFilter === 'funding' ? 'projects' : 'offerings'}</option>
            {visibleOfferings.map(o => (
              <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>
                {o.kind === 'product' ? '🛍 ' : '💰 '}{o.name}
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

      {/* Source filter tabs — LinkedIn 1st / 2nd / cold / Brave.
          Single honest count per chip; sums to All. Operator narrows
          further with the Contact-status filter below. */}
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

      {/* Quality filters — Min score, Exclude out-of-scope, Hide low
          conf, Hide already targeted. Contact filter removed 2026-05-19
          (operator: "source IS the channel — Brave = email, LinkedIn =
          LinkedIn DM, dropdown is redundant"). */}
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

      {/* Action bar — restructured 2026-05-17 from "5 buttons in one row" to
          "3-step workflow + recovery tools" after operator feedback that
          the original layout didn't communicate which buttons are
          primary vs which are recovery. Workflow row: do these in order.
          Recovery row: only when something's stuck. */}
      {selected.size > 0 && (
        <div className="mb-4 p-3 bg-dark-800 rounded-lg space-y-3">
          {/* Selection count + clear */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-dark-200 font-medium">{selected.size} prospect{selected.size === 1 ? '' : 's'} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-dark-400 hover:text-white text-xs">
              Clear selection
            </button>
          </div>

          {/* Primary workflow — do these in order, left to right */}
          <div>
            <p className="text-xs text-dark-300 uppercase tracking-wide font-semibold mb-2">
              Outreach workflow <span className="text-dark-500 font-normal normal-case tracking-normal">— run these in order</span>
            </p>
            <div className="flex items-stretch gap-2 flex-wrap">
              <button
                onClick={() => batchAction('enrich')}
                disabled={loading !== null}
                className="btn-secondary text-sm py-2 px-4 flex-1 min-w-[180px] text-left"
                title="Hunter.io looks up business email addresses for each selected prospect. Required if you plan to send emails (LinkedIn-DM-only outreach can skip this)."
              >
                {loading === 'enrich' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <>
                  <span className="font-semibold">1. Find Emails</span>
                  <span className="block text-xs text-dark-400 mt-0.5">Look up business email addresses (Hunter.io)</span>
                </>}
              </button>
              <button
                onClick={batchAssignSequences}
                disabled={loading !== null}
                className="btn-secondary text-sm py-2 px-4 flex-1 min-w-[180px] text-left"
                title="Assigns each selected prospect to the right outreach template (project- or product-side, warm or cold per network distance). Also runs LinkedIn / Brave research per prospect so the renderer has real signal. Low-ICP prospects are auto-skipped."
              >
                {loading === 'assign' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <>
                  <span className="font-semibold">2. Plan Outreach</span>
                  <span className="block text-xs text-dark-400 mt-0.5">Pick template + research each prospect</span>
                </>}
              </button>
              <button
                onClick={() => batchAction('draft')}
                disabled={loading !== null}
                className="btn-primary text-sm py-2 px-4 flex-1 min-w-[180px] text-left"
                title={`Generates the first message body for each prospect (Claude call) and sends it to Approvals immediately. Without this, the 15-min cron renders them in the background. Large selections auto-chunk in batches of ${RENDER_NOW_MAX}.`}
              >
                {loading === 'draft' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <>
                  <span className="font-semibold">3. Draft Messages Now</span>
                  <span className="block text-xs text-corp-green-200 mt-0.5">Write + send to Approvals</span>
                </>}
              </button>
            </div>
          </div>

          {/* Recovery tools — only when something's stuck. Separated visually
              so operators don't mistake them for part of the normal flow. */}
          <div className="pt-2 border-t border-dark-700">
            <p className="text-xs text-dark-300 uppercase tracking-wide font-semibold mb-2">
              Recovery tools <span className="text-dark-500 font-normal normal-case tracking-normal">— when something&apos;s stuck</span>
            </p>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <button
                onClick={reEnrichEvidence}
                disabled={loading !== null}
                className="text-blue-300 hover:text-blue-200 underline underline-offset-2 disabled:opacity-50"
                title="Wipes existing LinkedIn / Brave research for the selected prospects and refetches from scratch. Use when 'Draft now' reports a prospect blocked for 'no evidence' — refreshes the signal the renderer needs to ground the message."
              >
                {loading === 'reenrich' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Refresh research'}
                <span className="text-xs text-dark-500 ml-1">(if drafts blocked on no-evidence)</span>
              </button>
              <button
                onClick={resetSequences}
                disabled={loading !== null}
                className="text-amber-300 hover:text-amber-200 underline underline-offset-2 disabled:opacity-50"
                title="Deletes the current sequence assignment + any queued drafts for the selected prospects. Sent / replied messages are preserved. Use when the wrong template was assigned and you want to redo step 2."
              >
                {loading === 'reset' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Restart plan'}
                <span className="text-xs text-dark-500 ml-1">(if wrong template assigned)</span>
              </button>
              <button
                onClick={bulkFindEmails}
                disabled={loading !== null}
                className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2 disabled:opacity-50"
                title="Run Hunter.io against the selected prospects' domains to find a verified decision-maker email. Best used after filtering to 'Company only' or 'Has LinkedIn only'. ~$0.04 per lookup."
              >
                {loading === 'find_emails' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Find emails'}
                <span className="text-xs text-dark-500 ml-1">(Hunter — for Company-only rows)</span>
              </button>
              <button
                onClick={bulkDelete}
                disabled={loading !== null}
                className="text-red-400 hover:text-red-300 underline underline-offset-2 disabled:opacity-50"
                title="Hard-delete the selected prospects. Removes the partner rows + any associated sequence_steps + outbound_messages (FK cascade). No recovery — confirm carefully."
              >
                {loading === 'delete' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Delete prospects'}
                <span className="text-xs text-dark-500 ml-1">(permanent — clears dead contacts)</span>
              </button>
            </div>
          </div>
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
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
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
