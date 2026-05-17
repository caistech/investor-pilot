import Link from 'next/link';
import {
  Zap,
  ArrowRight,
  Search,
  UserCheck,
  Route,
  PenSquare,
  Inbox,
  Send,
  Reply,
  Building2,
  Briefcase,
} from 'lucide-react';

export const metadata = {
  title: 'How it works — InvestorPilot',
  description:
    'The seven-stage outreach pipeline behind InvestorPilot — same workflow for finding investors and finding buyers.',
};

const STAGES = [
  {
    n: 1,
    stage: 'Setup',
    icon: Building2,
    title: 'Pick a target — Project or Product',
    body: 'A Project is a funding raise (Series A, seed, debt facility, fund formation — 22 funding types supported, each with its own ICP). A Product is something you sell (SaaS, services, integrations). The engine routes investor outreach for Projects and sales/partner outreach for Products from the same workflow.',
  },
  {
    n: 2,
    stage: 'Discovery',
    icon: Search,
    title: 'Find prospects across Brave + LinkedIn',
    body: 'Brave web search surfaces firms matching the ICP query, LinkedIn discovers 1st-degree (warm) and 2nd-degree (mutual-connection) contacts at those firms. Operator can re-run discovery with different queries; dedupe is automatic across runs.',
  },
  {
    n: 3,
    stage: 'Scoring',
    icon: UserCheck,
    title: 'Score every candidate on 5 ICP dimensions',
    body: 'Each candidate is scored 1–10 on audience overlap, complementarity, partner readiness, reachability, and strategic leverage. Dimension weights are configurable per ICP (the default sales mix differs from senior-debt fund or VC-raise mixes). Out-of-scope candidates are explicitly hard-capped at 2/10 so they surface in the right bucket.',
  },
  {
    n: 4,
    stage: 'Enrichment',
    icon: Inbox,
    title: 'Find contact emails + read recent signal',
    body: 'Hunter.io lookups for verified business emails. LinkedIn deep-read for recent posts + firm news. Operator-injected notes count as ground truth and are weighted above public sources during signal extraction.',
  },
  {
    n: 5,
    stage: 'Plan Outreach',
    icon: Route,
    title: 'Assign each prospect to the right sequence',
    body: 'Multi-step templates (LinkedIn connect → DM → email cold → two follow-ups → close) tailored to the Project or Product. Prospects route to investor-tone or partner-tone templates automatically. Warm 1st-degree LinkedIn contacts get a different opener than cold 2nd-degree.',
  },
  {
    n: 6,
    stage: 'Drafting',
    icon: PenSquare,
    title: 'Render with tier-modulated tone + courtesy contract',
    body: 'Each draft is built around a 5-beat courtesy contract: Time-ack → Who-I-am → Why-you-personally → What-I-offer → Ask-last. High-fit prospects (score ≥7) get a direct ask. Mid-fit get a soft hedge. Low-fit get an exploratory "feel free to skip" frame. Translation for non-English markets is built and being validated in pilot; the English original always stays visible to the operator before send.',
  },
  {
    n: 7,
    stage: 'Approval + Send',
    icon: Send,
    title: 'Human-in-the-loop, then ship',
    body: 'Every draft goes to /approvals with its fit score, tier badge, compliance check, and personalisation score. Edit inline, regenerate, skip, or approve. Approved messages send via Resend (email) or Unipile (LinkedIn). Daily caps and per-channel kill switches are enforced server-side.',
  },
  {
    n: 8,
    stage: 'Track',
    icon: Reply,
    title: 'Track replies + bounces (manual today, webhook auto-routing in build)',
    body: 'Operator marks replies and bounces from the Track view; the system transitions partner.status accordingly and pauses downstream sends. Inbound-webhook auto-routing (Resend bounces + Unipile replies → automatic partner.status + step cancellation) is the next-up build. The full audit log — every discovery, scoring, draft, approval, send, manual reply mark — is written to audit_events for export and compliance review.',
  },
];

export default function PlaybookPage() {
  return (
    <div className="min-h-screen bg-dark-950">
      <header className="border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-corp-green-500" />
            <span className="text-xl font-bold">InvestorPilot</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="nav-link hidden sm:inline">Pricing</Link>
            <Link href="/about" className="nav-link hidden sm:inline">About</Link>
            <Link href="/login" className="nav-link">Sign in</Link>
            <Link href="/signup" className="btn-primary">Get Started</Link>
          </div>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">How it works</h1>
          <p className="text-dark-300 text-lg max-w-2xl mx-auto">
            Eight stages from setup to reply tracking. Same pipeline runs
            investor outreach (Projects) and sales outreach (Products) — the
            tone, templates, and signal sources shift per target, the workflow
            stays the same.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          <div className="card border-corp-green-500/30 bg-corp-green-500/5">
            <div className="flex items-start gap-3">
              <Briefcase className="w-6 h-6 text-corp-green-400 flex-shrink-0 mt-1" />
              <div>
                <h4 className="mb-1">Projects (Funding)</h4>
                <p className="text-dark-300 text-sm">
                  Pick a funding type (pre-seed → Series C+, debt facility,
                  fund close, grants). Engine targets VCs, family offices,
                  private credit funds, LPs aligned to the raise profile.
                </p>
              </div>
            </div>
          </div>
          <div className="card border-blue-500/30 bg-blue-500/5">
            <div className="flex items-start gap-3">
              <Building2 className="w-6 h-6 text-blue-400 flex-shrink-0 mt-1" />
              <div>
                <h4 className="mb-1">Products (Sales)</h4>
                <p className="text-dark-300 text-sm">
                  Define a product pitch + ICP. Engine targets buyers, channel
                  partners, resellers, integration partners — decision-makers
                  who&apos;d move on the offer.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {STAGES.map((s) => (
            <div key={s.n} className="card">
              <div className="flex items-start gap-5">
                <div className="flex-shrink-0 w-10 h-10 bg-corp-green-500/10 text-corp-green-400 rounded-lg flex items-center justify-center font-bold">
                  {s.n}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <s.icon className="w-4 h-4 text-dark-400" />
                    <span className="text-dark-500 text-xs uppercase tracking-wider">{s.stage}</span>
                  </div>
                  <h4 className="mb-2">{s.title}</h4>
                  <p className="text-dark-300 text-sm">{s.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card mt-12 border-corp-green-500/20 bg-corp-green-500/5">
          <h4 className="mb-2">Sample-to-self before you commit</h4>
          <p className="text-dark-300 text-sm">
            Once your sender identity is set, one click runs the whole pipeline
            against you — Brave + LinkedIn enrichment on your own profile,
            fit-signal extraction, render, delivery to your inbox. See what
            the system would write to a real prospect before you set up a single
            one. Free, no commitment.
          </p>
        </div>

        <div className="text-center mt-12">
          <Link href="/signup" className="btn-primary text-lg px-8 py-3 inline-flex items-center gap-2">
            Try it now <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-dark-800 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-dark-500">
          Built by{' '}
          <a href="https://corporateaisolutions.com" className="text-white hover:text-corp-green-400">
            Corporate AI Solutions
          </a>
        </div>
      </footer>
    </div>
  );
}
