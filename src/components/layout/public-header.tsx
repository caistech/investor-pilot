import Link from 'next/link';
import { Zap } from 'lucide-react';

export default function PublicHeader() {
  return (
    <header className="border-b border-dark-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Zap className="w-6 h-6 text-corp-green-500" />
          <span className="text-lg sm:text-xl font-bold">InvestorPilot</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/playbook" className="nav-link hidden md:inline">How it works</Link>
          <Link href="/demo" className="nav-link hidden md:inline">Demo</Link>
          <Link href="/pricing" className="nav-link hidden md:inline">Pricing</Link>
          <Link href="/about" className="nav-link hidden md:inline">About</Link>
          <Link href="/contact" className="nav-link hidden md:inline">Contact</Link>
          <Link href="/login" className="nav-link text-sm sm:text-base">Sign in</Link>
          <Link href="/signup" className="btn-primary text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3">Get Started</Link>
        </div>
      </div>
    </header>
  );
}
