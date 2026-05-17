import Link from 'next/link';
import {
  Zap,
  Search,
  MessageSquare,
  ShieldCheck,
  Pause,
  Sliders,
  Languages,
  FileText,
  TestTube2,
  Inbox,
} from 'lucide-react';

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
            <Link href="/playbook" className="nav-link hidden sm:inline">How it works</Link>
            <Link href="/pricing" className="nav-link hidden sm:inline">Pricing</Link>
            <Link href="/about" className="nav-link hidden sm:inline">About</Link>
            <Link href="/login" className="nav-link">Sign in</Link>
            <Link href="/signup" className="btn-primary">Get Started</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="badge-green mb-6 mx-auto inline-block">Direct outreach platform</div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
          Raise capital. Reach partners.<br />
          <span className="text-corp-green-400">One pipeline.</span>
        </h1>
        <p className="text-dark-300 text-xl max-w-2xl mx-auto mb-4">
          InvestorPilot finds the right capital providers for your raise <em>and</em>
          the right buyers for your product, then drafts evidence-grounded
          outreach you approve before it ships.
        </p>
        <p className="text-dark-400 max-w-2xl mx-auto mb-8 text-base">
          Two modes, same workflow. <strong className="text-white">Projects</strong>{' '}
          target VCs, family offices, private credit funds, and LPs.{' '}
          <strong className="text-white">Products</strong> target buyers,
          channel partners, and integration partners.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/signup" className="btn-primary text-lg px-8 py-3">Get Started</Link>
          <Link href="/playbook" className="btn-secondary text-lg px-8 py-3">See how it works</Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: Search,
              title: 'Targeted discovery + scoring',
              desc: 'Brave web search + LinkedIn 1st/2nd-degree discovery, scored on 5 ICP dimensions (audience overlap, complementarity, readiness, reachability, leverage). Every score links back to the evidence that produced it.',
            },
            {
              icon: Sliders,
              title: 'Score-tiered tone',
              desc: 'High-fit prospects get a direct ask. Mid-fit get hedged copy ("may be off-base, but worth flagging"). Low-fit get exploratory framing ("not sure if this is your space — feel free to skip"). Operator picks a fit floor; the renderer matches tone to score.',
            },
            {
              icon: Languages,
              title: 'Auto-localisation',
              desc: 'Drafts to investors in non-English markets — Vietnam, Korea, Japan, China, Saudi, Brazil, France, Germany and more — translate at render time. English original kept for operator review before send.',
            },
            {
              icon: MessageSquare,
              title: 'LinkedIn + email, same queue',
              desc: 'LinkedIn connection requests, LinkedIn DMs (via Unipile), and email (via Resend) sequenced together. Replies route back to the prospect and pause follow-ups automatically.',
            },
            {
              icon: FileText,
              title: 'Deck + KB ingestion (with vision)',
              desc: 'Upload pitch decks, one-pagers, transcripts. Text PDFs extract directly; image-only PDFs and PNG/JPG slides fall back to Claude vision. Same KB feeds discovery, scoring, and drafting.',
            },
            {
              icon: ShieldCheck,
              title: 'Pre-send compliance filter',
              desc: 'Per-product compliance rulesets (standard, finance_au_senior_debt, or custom) run on every draft pre-send. Blocked drafts surface in /approvals with the exact flagged term — fix inline, status flips back to queued.',
            },
            {
              icon: Inbox,
              title: 'Human-in-the-loop approvals',
              desc: 'Nothing ships without your sign-off. Each draft shows fit score, tier badge, compliance check, and personalisation score. Edit, regenerate, skip, or approve from the queue.',
            },
            {
              icon: TestTube2,
              title: 'Sample-to-self',
              desc: 'One-click end-to-end test: runs the full pipeline against you (Brave + LinkedIn enrichment on your own profile, render, send to your inbox). See what the system would write to a real prospect before you set up a single one.',
            },
            {
              icon: Pause,
              title: 'Caps + global kill switch',
              desc: 'Daily send caps and warmup curves enforced server-side. Operator-triggered global pause halts every channel in seconds — full audit log of every send, reply, approval, and pause.',
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
            <Link href="/playbook" className="hover:text-white">How it works</Link>
            <Link href="/pricing" className="hover:text-white">Pricing</Link>
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
