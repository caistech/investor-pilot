'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Info, X, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { getPageGuide } from '@/lib/dashboard/page-guides';

const DISMISS_PREFIX = 'investorpilot:page-guide-dismissed:';
const COLLAPSE_PREFIX = 'investorpilot:page-guide-collapsed:';

// Guard against SSR
if (typeof window === 'undefined') {
  // Don't render during SSR
}

/**
 * Per-page operator guide. Reads its copy from src/lib/dashboard/page-guides.ts
 * keyed by pathname. Sits at the top of every dashboard page (mounted from
 * the dashboard layout) and is per-page dismissible — the user only sees a
 * given page's guide until they collapse or dismiss it for that page.
 *
 * State is held in localStorage so the choice survives reloads but stays
 * client-only (no DB writes, no PII).
 */
export function PageGuide() {
  const pathname = usePathname();
  const guide = getPageGuide(pathname);

  const dismissKey = DISMISS_PREFIX + pathname;
  const collapseKey = COLLAPSE_PREFIX + pathname;

  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(dismissKey) === '1');
      setCollapsed(window.localStorage.getItem(collapseKey) === '1');
    } catch {
      setDismissed(false);
    }
    setHydrated(true);
  }, [dismissKey, collapseKey]);

  if (!guide || !hydrated || dismissed) return null;

  function dismiss() {
    try { window.localStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
    setDismissed(true);
  }

  function toggleCollapse() {
    const next = !collapsed;
    try { window.localStorage.setItem(collapseKey, next ? '1' : '0'); } catch { /* ignore */ }
    setCollapsed(next);
  }

  if (collapsed) {
    return (
      <button
        onClick={toggleCollapse}
        className="mb-4 flex items-center gap-2 text-xs text-dark-500 hover:text-dark-300 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
        Show page guide
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <div className="card mb-6 border-corp-green-500/20 bg-corp-green-500/5 relative">
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          onClick={toggleCollapse}
          className="p-1 rounded text-dark-400 hover:text-white hover:bg-dark-800 transition-colors"
          aria-label="Collapse guide"
          title="Collapse"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={dismiss}
          className="p-1 rounded text-dark-400 hover:text-white hover:bg-dark-800 transition-colors"
          aria-label="Dismiss guide"
          title="Dismiss for this page"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3 text-sm text-corp-green-400">
        <Info className="w-4 h-4" />
        <span className="font-medium">{guide.title} — quick guide</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 pr-16">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-1">What this is</p>
          <p className="text-sm text-dark-200 leading-relaxed">{guide.what_is}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-1">What to do</p>
          <p className="text-sm text-dark-200 leading-relaxed">{guide.what_to_do}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-1">What to expect</p>
          <p className="text-sm text-dark-200 leading-relaxed">{guide.what_to_expect}</p>
        </div>
      </div>

      {guide.next && (
        <div className="flex items-center justify-end">
          <Link
            href={guide.next.href}
            className="inline-flex items-center gap-1.5 text-sm text-corp-green-400 hover:text-corp-green-300 font-medium"
          >
            Next: {guide.next.label}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
