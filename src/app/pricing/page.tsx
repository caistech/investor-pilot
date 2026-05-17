import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';
import { PricingSuggestionForm } from './pricing-suggestion-form';
import Link from 'next/link';
import { ArrowRight, Lightbulb } from 'lucide-react';

export const metadata = {
  title: 'Pricing — InvestorPilot',
  description:
    'Pricing for InvestorPilot is being finalised. Tell us what the platform would be worth to you — we read every response.',
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <div className="text-center mb-12">
          <div className="badge-amber mb-4 inline-block">Coming soon</div>
          <h1 className="mb-4">Pricing</h1>
          <p className="text-dark-300 text-lg max-w-2xl mx-auto">
            We&apos;re finalising plans across solo operators, teams, and
            agency operators running multiple raises or sales motions. While
            we do that, the most useful thing you can tell us is what
            InvestorPilot would be worth <em>to you</em>.
          </p>
        </div>

        <div className="card mb-8 border-corp-green-500/20 bg-corp-green-500/5">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-corp-green-400 flex-shrink-0 mt-1" />
            <div className="text-sm text-dark-200">
              <p className="font-semibold text-white mb-1">Why we&apos;re asking</p>
              <p>
                Pricing a platform that runs an investor raise vs a sales motion
                is meaningfully different. We&apos;d rather hear from real
                operators than guess. Every response goes directly to the founder
                — no marketing list, no autoresponder follow-up.
              </p>
            </div>
          </div>
        </div>

        <PricingSuggestionForm />

        <div className="card mt-10 text-center">
          <h4 className="mb-2">Until pricing lands</h4>
          <p className="text-dark-300 mb-4 text-sm">
            InvestorPilot is in active pre-launch. Founding-operator access is
            being granted case-by-case alongside counsel review. If you&apos;d
            like to talk before pricing publishes, reach out via Corporate AI
            Solutions.
          </p>
          <a
            href="https://corporate-ai-solutions.vercel.app/about"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary inline-flex items-center gap-2"
          >
            Corporate AI Solutions <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        <div className="text-center mt-10">
          <Link href="/playbook" className="nav-link inline-flex items-center gap-1">
            See what the platform does <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
