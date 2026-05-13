import Link from 'next/link';
import { Zap, Search, MessageSquare, ShieldCheck, BarChart3, Pause } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-dark-950">
      <header className="border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-corp-green-500" />
            <span className="text-xl font-bold">InvestorPilot</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/about" className="nav-link hidden sm:inline">About</Link>
            <Link href="/login" className="nav-link">Sign in</Link>
            <Link href="/signup" className="btn-primary">Get Started</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="badge-green mb-6 mx-auto inline-block">Direct outreach platform</div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
          Reach the right prospects<br />
          <span className="text-corp-green-400">on every channel</span>
        </h1>
        <p className="text-dark-300 text-xl max-w-2xl mx-auto mb-8">
          InvestorPilot is multi-channel outreach software for operators who run
          direct, evidence-grounded campaigns. Discover, score, draft, approve,
          and send across LinkedIn and email from one workspace.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/signup" className="btn-primary text-lg px-8 py-3">Get Started</Link>
          <Link href="/about" className="btn-secondary text-lg px-8 py-3">Learn More</Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: Search,
              title: 'Targeted discovery',
              desc: 'Web search and AI-driven scoring identify the right prospects across your ICP. Every score is backed by evidence you can audit.',
            },
            {
              icon: MessageSquare,
              title: 'Multi-channel sending',
              desc: 'LinkedIn connection requests, LinkedIn DMs, and email — sent from your accounts, sequenced, and tracked in one queue.',
            },
            {
              icon: ShieldCheck,
              title: 'Pre-send compliance filter',
              desc: 'Every draft passes a regex + LLM check against your configured rules before it can be approved. Blocked content is flagged with the exact reason.',
            },
            {
              icon: BarChart3,
              title: 'Operator dashboard',
              desc: 'Funnel metrics, per-channel attribution, account health, and conversion to the outcome that matters — meetings, term sheets, signed deals.',
            },
            {
              icon: Pause,
              title: 'Kill switch + caps',
              desc: 'Daily caps and warmup curves enforced server-side. Operator-triggered global pause halts every channel in seconds when a campaign needs to stop.',
            },
            {
              icon: Zap,
              title: 'Audit trail by default',
              desc: 'Every action — discovery, approval, send, reply — is logged. Transparent for compliance, debuggable for operations.',
            },
          ].map((f) => (
            <div key={f.title} className="card-hover">
              <f.icon className="w-8 h-8 text-corp-green-400 mb-4" />
              <h4 className="mb-2">{f.title}</h4>
              <p className="text-dark-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="card max-w-3xl mx-auto text-center">
          <h3 className="mb-3">Designed for operators who need control</h3>
          <p className="text-dark-300 mb-2">
            InvestorPilot is software you run. It does not place capital, give
            financial advice, or solicit investment on your behalf. Operators
            stay in the loop on every approval, every send, every reply.
          </p>
          <p className="text-dark-500 text-sm">
            Compliance with applicable financial-services and communications
            regulations remains the operator&apos;s responsibility.
          </p>
        </div>
      </section>

      <footer className="border-t border-dark-800 py-8 mt-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-corp-green-500" />
            <span className="text-sm text-dark-400">
              Built by{' '}
              <a href="https://corporateaisolutions.com" className="text-white hover:text-corp-green-400">
                Corporate AI Solutions
              </a>
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-dark-500">
            <Link href="/about" className="hover:text-white">About</Link>
            <Link href="/contact" className="hover:text-white">Contact</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
