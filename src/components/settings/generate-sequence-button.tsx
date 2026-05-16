'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface GenerateSequenceButtonProps {
  /** Pre-select a specific product to generate from; defaults server-side to the first active product. */
  productId?: string;
  /** primary = filled CTA button; secondary = subtle text button for "Regenerate" placements. */
  variant?: 'primary' | 'secondary';
  /** Button label. */
  label?: string;
  /** When true, asks the user to confirm — used on Regenerate to avoid blowing away edits. */
  confirmBeforeRun?: boolean;
}

/**
 * Calls /api/sequences/generate-from-product. Surfaces the route's
 * cap-exceeded / no-pitch / no-sender errors as inline messages so the
 * user can fix them and retry without leaving the page.
 */
export function GenerateSequenceButton({
  productId,
  variant = 'primary',
  label = 'Generate sequence from product',
  confirmBeforeRun = false,
}: GenerateSequenceButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      const res = await fetch('/api/sequences/generate-from-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productId ? { product_id: productId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || data.reason || `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      setSuccess(`Created "${data.template_name}" — ${data.steps_count} steps.`);
      router.refresh();
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
        disabled={busy}
        className={`${baseClasses} disabled:opacity-50`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy ? 'Generating…' : label}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-400 max-w-2xl">{error}</p>
      )}
      {success && (
        <p className="mt-2 text-sm text-corp-green-400 max-w-2xl">{success}</p>
      )}
    </div>
  );
}
