import Link from 'next/link';
import { Zap } from 'lucide-react';

export default function PublicHeader() {
  return (
    <header className="border-b border-dark-800">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-corp-green-500" />
          <span className="text-xl font-bold">InvestorPilot</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/playbook" className="nav-link hidden sm:inline">How it works</Link>
          <Link href="/pricing" className="nav-link hidden sm:inline">Pricing</Link>
          <Link href="/about" className="nav-link hidden sm:inline">About</Link>
          <Link href="/contact" className="nav-link hidden sm:inline">Contact</Link>
          <Link href="/login" className="nav-link">Sign in</Link>
          <Link href="/signup" className="btn-primary">Get Started</Link>
        </div>
      </div>
    </header>
  );
}
