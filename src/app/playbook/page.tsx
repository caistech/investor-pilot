import Link from 'next/link';
import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';
import {
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
  BarChart3,
  Users,
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
    body: 'Each draft is built around a 5-beat courtesy contract: Time-ack → Who-I-am → Why-you-personally → What-I-offer → Ask-last. High-fit prospects (score ≥7) get a direct ask. Mid-fit get a soft hedge. Low-fit get an exploratory "feel free to skip" frame. For non-English markets the draft is auto-translated at render time (14 languages — Vietnamese, Korean, Japanese, Chinese, Thai, Indonesian, Arabic, Portuguese, Spanish, French, German, Italian, Turkish, Russian); the English original stays in the audit trail and is one click away in /approvals so operators (and reviewers who don\'t read the target language) can verify before send.',
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
    title: 'Track replies + auto-handle bounces',
    body: 'Resend webhook (svix-signed) listens for email.bounced / email.complained / email.delivery_delayed. A bounced address auto-marks the prospect as contact_partial, clears the bad email so the enrich stage can re-run on a fresh address, and cancels any pending downstream steps for that prospect — no piling sends onto a dead inbox. Replies still flagged manually today via the Track view; Unipile inbound webhook for auto-routing LinkedIn replies is on the next-up queue. The full audit log — every discovery, scoring, draft, approval, send, bounce, manual reply mark — is written to audit_events for export and compliance review.',
  },
];

export default function PlaybookPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

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

        {/* The deliverable — Pool Summary, the artifact operators hand to
            sponsors. Sits between the stage list and the team/sample CTAs
            so it's the first thing a reader sees after they've followed
            the pipeline through to its output. */}
        <div className="card mt-12 border-blue-500/30 bg-blue-500/5">
          <div className="flex items-start gap-3">
            <BarChart3 className="w-6 h-6 text-blue-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="mb-2">What you get to hand to your sponsor</h4>
              <p className="text-dark-300 text-sm mb-2">
                Every Project and Product gets an auto-generated{' '}
                <strong className="text-white">Pool Summary</strong> — a
                one-page deliverable showing scored count, score-tier
                histogram, geographic distribution, language distribution
                (&ldquo;12 prospects will receive their first message in
                Vietnamese&rdquo;), top 10 by score, narrative insights, and a
                print-to-PDF button. The platform turns discovery into a
                deliverable, not just a list — pass it on to your sponsor, IC,
                or board as-is.
              </p>
            </div>
          </div>
        </div>

        {/* Teams iteration — surfaced as its own section because it
            changes the operating model (solo → coordinated team). */}
        <div className="card mt-6 border-corp-green-500/20 bg-corp-green-500/5">
          <div className="flex items-start gap-3">
            <Users className="w-6 h-6 text-corp-green-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="mb-2">Run it as a team</h4>
              <p className="text-dark-300 text-sm">
                Invite teammates by email; each connects their own LinkedIn
                and inbox. Templates, products, projects, KB and prospects stay
                <strong className="text-white"> shared</strong> across the org
                so messaging is consistent; outreach goes out from each
                member&apos;s
                <strong className="text-white"> own account</strong> so the
                recipient sees a real person they can verify. The sequencer
                picks the right member&apos;s channel per step automatically.
                Owner / admin / member roles, branded invite emails, audit-logged.
              </p>
            </div>
          </div>
        </div>

        <div className="card mt-6 border-corp-green-500/20 bg-corp-green-500/5">
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

      <PublicFooter />
    </div>
  );
}
