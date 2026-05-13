import Link from 'next/link';
import { Zap, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center px-6">
      <Link href="/" className="flex items-center gap-2 mb-12">
        <Zap className="w-6 h-6 text-corp-green-500" />
        <span className="text-xl font-bold">InvestorPilot</span>
      </Link>

      <div className="text-center max-w-md">
        <p className="text-corp-green-500 text-7xl font-bold mb-4">404</p>
        <h2 className="mb-3">Page not found</h2>
        <p className="text-dark-400 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/" className="btn-primary inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back home
        </Link>
      </div>
    </div>
  );
}
