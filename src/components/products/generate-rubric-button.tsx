'use client';

import { useState } from 'react';
import { Sparkles, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface GenerateRubricButtonProps {
  productId: string;
  /** True when product.scoring_rubric is already populated — switches the
   *  button to a regenerate state with confirmation. */
  alreadyConfigured: boolean;
  /** Non-null = button disabled with this reason shown inline. */
  disabledReason?: string | null;
  disabledFixHref?: string;
  disabledFixLabel?: string;
}

/**
 * Calls /api/products/generate-scoring-rubric. Surfaces the route's
 * cap-exceeded / no-pitch errors as inline messages so the user can fix
 * them and retry without leaving the products page.
 */
export function GenerateRubricButton({
  productId,
  alreadyConfigured,
  disabledReason = null,
  disabledFixHref,
  disabledFixLabel,
}: GenerateRubricButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const blocked = !!disabledReason;

  async function handleClick() {
    if (alreadyConfigured) {
      const ok = window.confirm(
        'This will overwrite the current scoring rubric with a freshly-generated one. Any manual edits in Settings → ICP will be lost. Continue?',
      );
      if (!ok) return;
    }
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch('/api/products/generate-scoring-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.reason || `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Scoring rubric saved (${data.icp_categories.length} categories, ${data.icp_reject_categories.length} reject categories). You can run Find Investors now.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || blocked}
        title={blocked ? disabledReason ?? '' : undefined}
        className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : alreadyConfigured ? <ShieldCheck className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        {busy
          ? 'Generating…'
          : alreadyConfigured
            ? 'Regenerate ICP scoring rubric'
            : 'Generate ICP scoring rubric'}
      </button>
      {blocked && (
        <p className="mt-2 text-sm text-amber-400 max-w-2xl">
          {disabledReason}
          {disabledFixHref && disabledFixLabel && (
            <>
              {' '}
              <a href={disabledFixHref} className="underline hover:text-amber-300">
                {disabledFixLabel} →
              </a>
            </>
          )}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400 max-w-2xl">{error}</p>}
      {success && <p className="mt-2 text-sm text-corp-green-400 max-w-2xl">{success}</p>}
    </div>
  );
}
