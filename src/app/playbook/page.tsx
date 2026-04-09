import Link from 'next/link';
import { Zap, ArrowRight, CheckCircle } from 'lucide-react';

const steps = [
  {
    playbook: 'Generate 5-8 categories of companies whose customers match ICP',
    product: 'AI generates categories with audience overlap rationale. You approve before searching.',
    stage: 'Categories',
  },
  {
    playbook: 'Search for 3-5 candidates per category using Brave Search',
    product: 'Brave Search MCP finds candidates automatically. Deduplicates across categories.',
    stage: 'Discovery',
  },
  {
    playbook: 'Screen out competitors, wrong-size firms, closed ecosystems',
    product: 'Negative screening runs automatically against exclusion rules you define.',
    stage: 'Screening',
  },
  {
    playbook: 'Score each candidate on 5 dimensions with evidence',
    product: 'AI scores audience overlap (30%), complementarity (25%), readiness (20%), reachability (15%), leverage (10%). Radar chart visualization.',
    stage: 'Scoring',
  },
  {
    playbook: 'Browse company websites to find team and partnership signals',
    product: 'Visits homepage, /about, /team, /partners in sequence. Records what was found vs inferred.',
    stage: 'Browsing',
  },
  {
    playbook: 'Find the right contact based on partnership motion',
    product: 'Hunter MCP enriches contacts. Email verified with confidence score. Fallback to domain search.',
    stage: 'Contact Finding',
  },
  {
    playbook: 'Select partnership motion (referral, integration, co-marketing, etc.)',
    product: 'AI recommends motion based on readiness tier, company size, and traction. You approve.',
    stage: 'Motion Selection',
  },
  {
    playbook: 'Draft outreach email with anti-hallucination rules',
    product: 'Evidence-grounded drafts. Opening line must reference observed data. Under 150 words. You review before filing.',
    stage: 'Drafting',
  },
  {
    playbook: 'File draft in Gmail for founder review',
    product: 'Gmail MCP creates a pre-addressed draft. Never sends automatically.',
    stage: 'Filing',
  },
];

export default function PlaybookPage() {
  return (
    <div className="min-h-screen bg-dark-950">
      <header className="border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-corp-green-500" />
            <span className="text-xl font-bold">PartnerPilot</span>
          </Link>
          <Link href="/signup" className="btn-primary">Get Started</Link>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4">The Playbook, Productised</h1>
          <p className="text-dark-300 text-lg max-w-2xl mx-auto">
            Every step of{' '}
            <a
              href="https://www.linkedin.com/pulse/partnerships-agent-playbook-claude-guillermo-flor-zdzdf/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-corp-green-400 hover:text-corp-green-300 underline"
            >
              Guillermo Flor&apos;s Partnerships Agent Playbook
            </a>
            , built into a SaaS you can run in 30 minutes.
          </p>
        </div>

        <div className="space-y-6">
          {steps.map((step, i) => (
            <div key={i} className="card">
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0 w-10 h-10 bg-corp-green-500/10 text-corp-green-400 rounded-lg flex items-center justify-center font-bold">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-dark-500 text-xs uppercase tracking-wider mb-1">{step.stage}</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-dark-500 text-xs mb-1">Playbook says:</div>
                      <p className="text-dark-300 text-sm">{step.playbook}</p>
                    </div>
                    <div>
                      <div className="text-corp-green-500 text-xs mb-1 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> PartnerPilot does:
                      </div>
                      <p className="text-white text-sm">{step.product}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-16">
          <Link href="/signup" className="btn-primary text-lg px-8 py-3 inline-flex items-center gap-2">
            Try It Now <ArrowRight className="w-5 h-5" />
          </Link>
          <p className="text-dark-500 text-sm mt-4">30-day free trial. No credit card required.</p>
        </div>
      </section>

      <footer className="border-t border-dark-800 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-dark-500">
          Built by <a href="https://corporateaisolutions.com" className="text-white hover:text-corp-green-400">Corporate AI Solutions</a>
        </div>
      </footer>
    </div>
  );
}
