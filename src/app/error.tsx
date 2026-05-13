'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Zap, AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error boundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center px-6">
      <Link href="/" className="flex items-center gap-2 mb-12">
        <Zap className="w-6 h-6 text-corp-green-500" />
        <span className="text-xl font-bold">InvestorPilot</span>
      </Link>

      <div className="text-center max-w-md">
        <AlertTriangle className="w-16 h-16 text-amber-400 mx-auto mb-4" />
        <h2 className="mb-3">Something went wrong</h2>
        <p className="text-dark-400 mb-2">
          An unexpected error occurred. Please try again, or contact support if the issue persists.
        </p>
        {error.digest && (
          <p className="text-dark-500 text-xs mb-8 font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button onClick={reset} className="btn-primary inline-flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            Try again
          </button>
          <Link href="/" className="btn-secondary inline-flex items-center gap-2">
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
