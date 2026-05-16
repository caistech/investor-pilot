'use client';

import { useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';

interface IcpFormProps {
  productId: string;
  productName: string;
  initialRubric: string | null;
  initialCategories: string[] | null;
  initialPartnerType: string | null;
  initialRejectCategories: string[] | null;
  initialSpecialCases: string[] | null;
}

/**
 * Inline edit card for a product's ICP scoring configuration. The
 * scoring_rubric is the substantive multi-line description Claude reads
 * when scoring each candidate; the categories/reject/special-case lists
 * are formatted into the prompt as bullet sections.
 */
export function IcpForm({
  productId,
  productName,
  initialRubric,
  initialCategories,
  initialPartnerType,
  initialRejectCategories,
  initialSpecialCases,
}: IcpFormProps) {
  const [editing, setEditing] = useState(false);
  const [rubric, setRubric] = useState(initialRubric ?? '');
  const [categoriesText, setCategoriesText] = useState((initialCategories ?? []).join('\n'));
  const [partnerType, setPartnerType] = useState(initialPartnerType ?? '');
  const [rejectsText, setRejectsText] = useState((initialRejectCategories ?? []).join('\n'));
  const [specialText, setSpecialText] = useState((initialSpecialCases ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function linesToArray(text: string): string[] {
    return text
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/icp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          scoring_rubric: rubric.trim() || null,
          icp_categories: linesToArray(categoriesText),
          icp_partner_type: partnerType.trim() || null,
          icp_reject_categories: linesToArray(rejectsText),
          icp_special_cases: linesToArray(specialText),
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
    setRubric(initialRubric ?? '');
    setCategoriesText((initialCategories ?? []).join('\n'));
    setPartnerType(initialPartnerType ?? '');
    setRejectsText((initialRejectCategories ?? []).join('\n'));
    setSpecialText((initialSpecialCases ?? []).join('\n'));
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4>ICP & scoring rubric</h4>
            <p className="text-dark-500 text-xs mt-1">Product: {productName}</p>
          </div>
          <button onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Edit
          </button>
        </div>
        <p className="text-dark-400 text-sm mb-4">
          Used by the discover pipeline to score each candidate on the 5 weighted dimensions
          (audience overlap, complementarity, partner readiness, reachability, strategic leverage).
          Edits take effect on the next discovery batch.
        </p>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-dark-400">Partner type label</span>
            <span>{initialPartnerType || <em className="text-amber-400">not set</em>}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Valid categories</span>
            <span>{(initialCategories ?? []).length} configured</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Reject categories</span>
            <span>{(initialRejectCategories ?? []).length} configured</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-400">Special-case overrides</span>
            <span>{(initialSpecialCases ?? []).length} configured</span>
          </div>
          <div className="pt-3 border-t border-dark-800">
            <p className="text-dark-400 mb-2">Scoring rubric</p>
            {initialRubric ? (
              <pre className="text-dark-300 text-xs whitespace-pre-wrap bg-dark-900 p-3 rounded max-h-48 overflow-y-auto">
                {initialRubric}
              </pre>
            ) : (
              <em className="text-amber-400 text-xs">not set — discovery will fail until configured</em>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h4 className="mb-1">Edit ICP & scoring rubric</h4>
      <p className="text-dark-500 text-xs mb-4">Product: {productName}</p>

      <div className="space-y-4 text-sm">
        <div>
          <label className="block text-dark-400 mb-1">
            Partner type <span className="text-dark-500">(single value — sets partners.partner_type)</span>
          </label>
          <input
            type="text"
            value={partnerType}
            onChange={(e) => setPartnerType(e.target.value)}
            placeholder="e.g. lender / advisor / reseller"
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-dark-400 mb-1">
            Valid categories <span className="text-dark-500">(one per line)</span>
          </label>
          <textarea
            value={categoriesText}
            onChange={(e) => setCategoriesText(e.target.value)}
            placeholder={'single family office\nmulti family office\nprivate credit fund'}
            rows={4}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-dark-400 mb-1">
            Scoring rubric <span className="text-dark-500">(multi-line description of how each dimension is scored)</span>
          </label>
          <textarea
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            rows={14}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-xs font-mono"
          />
        </div>

        <div>
          <label className="block text-dark-400 mb-1">
            Reject categories <span className="text-dark-500">(one per line — auto-cap scores at 0-2)</span>
          </label>
          <textarea
            value={rejectsText}
            onChange={(e) => setRejectsText(e.target.value)}
            placeholder={'Retail bank credit officers\nMortgage brokers'}
            rows={6}
            className="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-dark-400 mb-1">
            Special-case overrides <span className="text-dark-500">(one per line — DO NOT REJECT exceptions)</span>
          </label>
          <textarea
            value={specialText}
            onChange={(e) => setSpecialText(e.target.value)}
            placeholder={'Institutional debt funds >$1B AUM IF they have a Singapore/HK construction-specialist desk'}
            rows={4}
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
