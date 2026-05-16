'use client';

import { useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import type { DraftFacility } from '@/lib/pipeline/draft-prompt';

interface ProductPitchFormProps {
  productId: string;
  productName: string;
  initialPitch: string | null;
  initialFacilities: DraftFacility[] | null;
  initialAssetClass: string | null;
  initialGeography: string | null;
  initialTicketMinLabel: string | null;
  initialTicketMaxLabel: string | null;
  initialForbiddenTerms: string[] | null;
}

/**
 * Inline edit card for a product's draft-prompt configuration: the high-level
 * pitch, the facility list, ticket-size routing labels, and the forbidden-terms
 * compliance list. Everything here flows into buildDraftPrompt() at request
 * time, so changes take effect on the next batch of draft generation.
 *
 * Facilities are edited as JSON (textarea) for v1 — operator paste-edits the
 * structured array. A row-repeater UI is the right next step but not in scope
 * for this initial cut.
 */
export function ProductPitchForm({
  productId,
  productName,
  initialPitch,
  initialFacilities,
  initialAssetClass,
  initialGeography,
  initialTicketMinLabel,
  initialTicketMaxLabel,
  initialForbiddenTerms,
}: ProductPitchFormProps) {
  const [editing, setEditing] = useState(false);
  const [pitch, setPitch] = useState(initialPitch ?? '');
  const [facilitiesJson, setFacilitiesJson] = useState(
    JSON.stringify(initialFacilities ?? [], null, 2),
  );
  const [assetClass, setAssetClass] = useState(initialAssetClass ?? '');
  const [geography, setGeography] = useState(initialGeography ?? '');
  const [ticketMin, setTicketMin] = useState(initialTicketMinLabel ?? '');
  const [ticketMax, setTicketMax] = useState(initialTicketMaxLabel ?? '');
  const [forbiddenText, setForbiddenText] = useState((initialForbiddenTerms ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    let facilities: DraftFacility[] | null = null;
    try {
      facilities = facilitiesJson.trim() ? JSON.parse(facilitiesJson) : null;
      if (facilities !== null && !Array.isArray(facilities)) {
        throw new Error('facility_summary must be an array');
      }
    } catch (err) {
      setError(`Facility JSON invalid: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
      return;
    }

    const forbidden = forbiddenText
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      const res = await fetch('/api/settings/product-pitch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          product_pitch: pitch.trim() || null,
          facility_summary: facilities,
          asset_class: assetClass.trim() || null,
          geography: geography.trim() || null,
          ticket_size_min_label: ticketMin.trim() || null,
          ticket_size_max_label: ticketMax.trim() || null,
          draft_compliance_forbidden_terms: forbidden,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Save failed');
        return;
      }
      setEditing(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setPitch(initialPitch ?? '');
    setFacilitiesJson(JSON.stringify(initialFacilities ?? [], null, 2));
    setAssetClass(initialAssetClass ?? '');
    setGeography(initialGeography ?? '');
    setTicketMin(initialTicketMinLabel ?? '');
    setTicketMax(initialTicketMaxLabel ?? '');
    setForbiddenText((initialForbiddenTerms ?? []).join('\n'));
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    const facilityCount = initialFacilities?.length ?? 0;
    const forbiddenCount = initialForbiddenTerms?.length ?? 0;
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4>Pitch & facilities</h4>
            <p className="text-dark-500 text-xs mt-1">Product: {productName}</p>
          </div>
          <button onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Edit
          </button>
        </div>
        <p className="text-dark-400 text-sm mb-4">
          Used by the draft pipeline to build the system prompt for every outbound email. Edits take
          effect on the next batch.
        </p>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-dark-400 mb-1">Pitch</p>
            <p className="text-dark-200 whitespace-pre-wrap">
              {initialPitch || <em className="text-amber-400">not set — drafting will fail until configured</em>}
            </p>
          </div>
          <div className="flex justify-between pt-2 border-t border-dark-800">
            <span className="text-dark-400">Facilities</span>
            <span>{facilityCount} configured</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Asset class</span>
            <span>{initialAssetClass || <em className="text-dark-500">—</em>}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Geography</span>
            <span>{initialGeography || <em className="text-dark-500">—</em>}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Ticket range</span>
            <span className="text-right max-w-md">
              {initialTicketMinLabel || initialTicketMaxLabel
                ? `${initialTicketMinLabel ?? '—'} → ${initialTicketMaxLabel ?? '—'}`
                : <em className="text-dark-500">—</em>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Forbidden terms</span>
            <span>{forbiddenCount} terms</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h4 className="mb-1">Edit pitch & facilities</h4>
      <p className="text-dark-500 text-xs mb-4">Product: {productName}</p>

      <div className="space-y-4 text-sm">
        <div>
          <label className="block text-dark-400 mb-1">Pitch</label>
          <textarea
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder="High-level description of what you're pitching, in the voice the prompt should adopt. e.g. 'Acme Capital's senior debt placement to family-office private debt allocators.'"
            rows={3}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-dark-400 mb-1">Asset class</label>
            <input
              type="text"
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              placeholder="e.g. AU property development debt"
              className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-dark-400 mb-1">Geography</label>
            <input
              type="text"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="e.g. Australia (TAS, WA)"
              className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-dark-400 mb-1">Min ticket label</label>
            <input
              type="text"
              value={ticketMin}
              onChange={(e) => setTicketMin(e.target.value)}
              placeholder="e.g. $1M"
              className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-dark-400 mb-1">Max ticket label</label>
            <input
              type="text"
              value={ticketMax}
              onChange={(e) => setTicketMax(e.target.value)}
              placeholder="e.g. $5M+"
              className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-dark-400 mb-1">
            Facilities (JSON array)
          </label>
          <textarea
            value={facilitiesJson}
            onChange={(e) => setFacilitiesJson(e.target.value)}
            rows={12}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-xs font-mono"
          />
          <p className="text-dark-500 text-xs mt-1">
            Each entry: <code>{`{ name, size_label, rate_label, term_label, evidence_anchor }`}</code>
          </p>
        </div>

        <div>
          <label className="block text-dark-400 mb-1">
            Forbidden terms <span className="text-dark-500">(one per line)</span>
          </label>
          <textarea
            value={forbiddenText}
            onChange={(e) => setForbiddenText(e.target.value)}
            placeholder={'guaranteed\nrisk-free\ntokenisation\nadvisor'}
            rows={6}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancel} disabled={saving} className="btn-secondary text-sm flex items-center gap-2">
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
