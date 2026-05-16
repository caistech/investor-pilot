'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface GenerateSequenceButtonProps {
  /** Pre-select a specific product to generate from; defaults server-side to the first active product. */
  productId?: string;
  /** Or pass a project ID — routes to /api/projects/generate-sequence (investor outreach) instead. */
  projectId?: string;
  /** primary = filled CTA button; secondary = subtle text button for "Regenerate" placements. */
  variant?: 'primary' | 'secondary';
  /** Button label. */
  label?: string;
  /** When true, asks the user to confirm — used on Regenerate to avoid blowing away edits. */
  confirmBeforeRun?: boolean;
  /** Non-null = button disabled with this reason shown inline + as tooltip. */
  disabledReason?: string | null;
  /** Link rendered next to the disabled reason so the user can fix the prereq. */
  disabledFixHref?: string;
  /** Label for the fix-link (e.g. "Set sender identity"). */
  disabledFixLabel?: string;
  /** Called after a successful save so parent client components can
   *  re-fetch state (router.refresh() only re-runs server components). */
  onSuccess?: () => void;
}

/**
 * Calls /api/sequences/generate-from-product. Surfaces the route's
 * cap-exceeded / no-pitch / no-sender errors as inline messages so the
 * user can fix them and retry without leaving the page.
 */
export function GenerateSequenceButton({
  productId,
  projectId,
  variant = 'primary',
  label = 'Generate sequence from product',
  confirmBeforeRun = false,
  disabledReason = null,
  disabledFixHref,
  disabledFixLabel,
  onSuccess,
}: GenerateSequenceButtonProps) {
  const isProject = !!projectId;
  const route = isProject ? '/api/projects/generate-sequence' : '/api/sequences/generate-from-product';
  const payload = isProject ? { project_id: projectId } : (productId ? { product_id: productId } : {});
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const blocked = !!disabledReason;

  async function handleClick() {
    if (confirmBeforeRun) {
      const ok = window.confirm(
        'This will replace the current auto-generated sequence with a fresh one. Manual edits to the existing template will be lost. Continue?',
      );
      if (!ok) return;
    }
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || data.reason || `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      setSuccess(`Created "${data.template_name}" — ${data.steps_count} steps.`);
      router.refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const baseClasses =
    variant === 'primary'
      ? 'btn-primary inline-flex items-center gap-2'
      : 'btn-secondary inline-flex items-center gap-2 text-sm';

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || blocked}
        title={blocked ? disabledReason ?? '' : undefined}
        className={`${baseClasses} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy ? 'Generating…' : label}
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
      {error && (
        <p className="mt-2 text-sm text-red-400 max-w-2xl">{error}</p>
      )}
      {success && (
        <p className="mt-2 text-sm text-corp-green-400 max-w-2xl">{success}</p>
      )}
    </div>
  );
}
