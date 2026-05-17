'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { summaryHeadline, type PoolSummary } from '@/lib/pool/summary';

interface Props {
  kind: 'project' | 'product';
  ownerId: string;
  ownerName: string;
}

/**
 * Inline chip on /projects + /products list rows. Lazy-fetches the
 * pool summary for one project or product and surfaces the headline
 * stat ("35 scored · 12 non-English · top: Vietnam") plus a deep-link
 * to the full {Name} Project Summary / Product Summary page.
 *
 * Replaces the prior tiny "Pool profile →" text link that buried the
 * value of the summary deliverable.
 */
export function PoolStatChip({ kind, ownerId, ownerName }: Props) {
  const [summary, setSummary] = useState<PoolSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const endpoint = kind === 'project'
      ? `/api/projects/${ownerId}/pool-report`
      : `/api/products/${ownerId}/pool-report`;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j) => {
        if (!cancelled) setSummary(j as PoolSummary);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, ownerId]);

  const href = kind === 'project'
    ? `/projects/${ownerId}/pool`
    : `/products/${ownerId}/pool`;
  const label = kind === 'project' ? 'Project Summary' : 'Product Summary';

  const headline = summary ? summaryHeadline(summary) : error ? 'Summary unavailable' : 'Loading…';

  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs hover:bg-blue-500/20 transition-colors group"
      title={`Open ${ownerName} ${label}`}
    >
      <BarChart3 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
      <span className="text-blue-200 group-hover:text-blue-100">
        <span className="hidden sm:inline text-blue-400 uppercase tracking-wide mr-1">{label}</span>
        <span>{headline}</span>
      </span>
    </Link>
  );
}
