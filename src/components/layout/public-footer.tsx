import Link from 'next/link';
import { Zap } from 'lucide-react';

export default function PublicFooter() {
  return (
    <footer className="border-t border-dark-800 py-10 mt-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-corp-green-500" />
              <span className="font-bold">InvestorPilot</span>
            </div>
            <p className="text-dark-400 text-sm">
              Multi-channel direct outreach platform built by Corporate AI Solutions.
            </p>
          </div>

          <div>
            <p className="font-medium mb-3 text-sm uppercase tracking-wide text-dark-300">Product</p>
            <ul className="space-y-2 text-sm">
              <li><Link href="/" className="text-dark-400 hover:text-white">Home</Link></li>
              <li><Link href="/about" className="text-dark-400 hover:text-white">About</Link></li>
              <li><Link href="/contact" className="text-dark-400 hover:text-white">Contact</Link></li>
              <li><Link href="/login" className="text-dark-400 hover:text-white">Sign in</Link></li>
            </ul>
          </div>

          <div>
            <p className="font-medium mb-3 text-sm uppercase tracking-wide text-dark-300">Legal</p>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-dark-400 hover:text-white">Privacy policy</Link></li>
              <li><Link href="/terms" className="text-dark-400 hover:text-white">Terms of service</Link></li>
              <li><Link href="/cookies" className="text-dark-400 hover:text-white">Cookie policy</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-dark-800 pt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="text-dark-500 text-xs leading-relaxed max-w-3xl">
            InvestorPilot is software. It does not provide financial advice, place
            capital, or solicit investment on the operator&apos;s behalf. Operators of
            the platform are responsible for compliance with applicable financial
            services, communications, and data-protection regulations in their
            jurisdiction.
          </p>
          <p className="text-dark-500 text-xs whitespace-nowrap">
            © {new Date().getFullYear()} Corporate AI Solutions
          </p>
        </div>
      </div>
    </footer>
  );
}
