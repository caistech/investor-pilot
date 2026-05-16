'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';

type SetupKey =
  | 'senderConfigured'
  | 'hasActiveProduct'
  | 'productPitchConfigured'
  | 'rubricConfigured'
  | 'channelConnected'
  | 'sequenceConfigured';

interface SetupState {
  senderConfigured: boolean;
  hasActiveProduct: boolean;
  productPitchConfigured: boolean;
  rubricConfigured: boolean;
  channelConnected: boolean;
  sequenceConfigured: boolean;
  allDone: boolean;
}

interface SetupGateProps {
  /** Prereqs that MUST be true before the page content makes sense. */
  required: SetupKey[];
  /** Page name used in the blocking message, e.g. "Discover", "Approvals". */
  pageName: string;
  /** Short sentence describing what the page does, used after "...before you can use". */
  pageVerb: string;
  children: ReactNode;
}

const GAP_LABELS: Record<SetupKey, { label: string; href: string }> = {
  senderConfigured: { label: 'Set your sender identity (name + role)', href: '/settings' },
  hasActiveProduct: { label: 'Create an active product', href: '/products' },
  productPitchConfigured: { label: 'Add a one-line description or pitch to your product', href: '/products' },
  rubricConfigured: { label: 'Generate the ICP scoring rubric on the product card', href: '/products' },
  channelConnected: { label: 'Connect a LinkedIn or email channel', href: '/channels' },
  sequenceConfigured: { label: 'Generate the outreach sequence on the product card', href: '/products' },
};

/**
 * Wraps page content. While setup-state loads, renders a quick spinner.
 * Once loaded, if any of `required` prereqs are false, renders a blocking
 * panel listing what's missing with deep-links. Otherwise renders children.
 *
 * Pages that are read-only (Outreach, Sessions) can use this with required=[]
 * just to show the dependencies inline before any data appears, or wrap the
 * empty-state in it.
 */
export function SetupGate({ required, pageName, pageVerb, children }: SetupGateProps) {
  const [state, setState] = useState<SetupState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/onboarding/setup-state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setState(data);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!loaded) {
    return (
      <div className="card text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-dark-500 mx-auto mb-3" />
        <p className="text-dark-500 text-sm">Checking setup…</p>
      </div>
    );
  }

  // No state — likely no org yet, or fetch failed. Let children render
  // (they have their own auth + empty-state handling); don't show our gate.
  if (!state) return <>{children}</>;

  const missing = required.filter((k) => !state[k]);
  if (missing.length === 0) return <>{children}</>;

  return (
    <div className="card border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-400">
            {pageName} isn&apos;t ready yet
          </p>
          <p className="text-dark-300 text-sm mt-1">
            Finish the {missing.length} {missing.length === 1 ? 'step' : 'steps'} below before you can {pageVerb}.
          </p>
          <ul className="mt-4 space-y-2">
            {missing.map((key) => (
              <li key={key}>
                <Link
                  href={GAP_LABELS[key].href}
                  className="inline-flex items-center gap-2 text-sm text-amber-300 hover:text-amber-200"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  {GAP_LABELS[key].label}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
