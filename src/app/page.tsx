import Link from 'next/link';
import { Zap, Search, Users, Mail, BarChart3, Shield } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-dark-950">
      <header className="border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-corp-green-500" />
            <span className="text-xl font-bold">PartnerPilot</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="nav-link">Sign in</Link>
            <Link href="/signup" className="btn-primary">Get Started</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="badge-green mb-6 mx-auto">AI-Powered Partnerships</div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
          Find channel partners<br />
          <span className="text-corp-green-400">with an AI agent</span>
        </h1>
        <p className="text-dark-300 text-xl max-w-2xl mx-auto mb-8">
          PartnerPilot discovers, scores, and prepares outreach for your ideal
          channel partners. Paste your ICP, watch the agent work.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/signup" className="btn-primary text-lg px-8 py-3">Start Free Trial</Link>
          <Link href="/playbook" className="btn-secondary text-lg px-8 py-3">See the Playbook</Link>
        </div>
        <p className="text-dark-500 text-sm mt-4">30-day free trial. No credit card required.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { icon: Search, title: 'AI Discovery', desc: 'Searches the web for partner candidates matching your ICP across 5-8 categories. Scores each on 5 evidence-based dimensions.' },
            { icon: Users, title: 'Contact Enrichment', desc: 'Finds the right person to contact based on partnership motion. Enriches with verified email via Hunter.' },
            { icon: Mail, title: 'Draft Outreach', desc: 'Generates personalised, evidence-grounded outreach emails. Anti-hallucination rules ensure nothing is fabricated.' },
            { icon: BarChart3, title: '5-Dimension Scoring', desc: 'Audience overlap, complementarity, partner readiness, reachability, and strategic leverage. Weighted and ranked.' },
            { icon: Shield, title: 'Evidence Trail', desc: 'Every claim backed by evidence. See exactly what the agent found, what it inferred, and where the data came from.' },
            { icon: Zap, title: 'Approval Gates', desc: 'The agent never sends anything automatically. You approve categories, candidates, contacts, and drafts at every stage.' },
          ].map((f) => (
            <div key={f.title} className="card-hover">
              <f.icon className="w-8 h-8 text-corp-green-400 mb-4" />
              <h4 className="mb-2">{f.title}</h4>
              <p className="text-dark-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 text-center">
        <div className="card max-w-2xl mx-auto">
          <p className="text-dark-300 text-lg">
            Inspired by{' '}
            <a href="https://www.linkedin.com/pulse/partnerships-agent-playbook-claude-guillermo-flor-zdzdf/" target="_blank" rel="noopener noreferrer" className="text-corp-green-400 hover:text-corp-green-300 underline">
              Guillermo Flor&apos;s Partnerships Agent Playbook
            </a>
          </p>
          <p className="text-dark-500 mt-2">The playbook, productised. Every step of the methodology, built into a SaaS you can run in 30 minutes.</p>
        </div>
      </section>

      <footer className="border-t border-dark-800 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-corp-green-500" />
            <span className="text-sm text-dark-400">
              Built by <a href="https://corporateaisolutions.com" className="text-white hover:text-corp-green-400">Corporate AI Solutions</a>
            </span>
          </div>
          <div className="text-sm text-dark-500">
            <a href="mailto:dennis@corporateaisolutions.com" className="hover:text-white">dennis@corporateaisolutions.com</a>
            {' | +61 402 612 471'}
          </div>
        </div>
      </footer>
    </div>
  );
}
