import Link from 'next/link';
import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';
import {
  Search,
  MessageSquare,
  ShieldCheck,
  Pause,
  Sliders,
  Languages,
  FileText,
  TestTube2,
  Inbox,
  Users,
  BarChart3,
  Reply,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

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
        <p className="text-dark-500 text-sm mt-6">
          For VC &amp; advisory firms: run outreach for your whole portfolio from one workspace.
        </p>
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
              title: 'Auto-localisation — 14 languages',
              desc: 'Vietnamese, Korean, Japanese, Chinese (Simplified + Traditional), Thai, Indonesian, Arabic, Brazilian Portuguese, Spanish, French, German, Italian, Turkish, Russian. Every prospect in a non-English market gets their first message in their language at render time. The English original is preserved in evidence_refs and shown in /approvals via a one-click toggle — operator verifies before send, the audit trail keeps both.',
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
              desc: 'Per-product compliance rulesets (standard + finance_au_senior_debt built in) run on every draft pre-send. Blocked drafts surface in /approvals with the exact flagged term — fix inline, status flips back to queued.',
            },
            {
              icon: Inbox,
              title: 'Human-in-the-loop approvals',
              desc: 'Nothing ships without your sign-off. Each draft shows fit score, tier badge, compliance check, and personalisation score. Edit, regenerate, skip, or approve from the queue.',
            },
            {
              icon: BarChart3,
              title: 'Pool Summary — your sponsor deliverable',
              desc: 'Every Project and Product gets an auto-generated one-page summary: scored count, score-tier histogram, geographic distribution, language distribution ("12 prospects will receive their first message in Vietnamese"), top 10 by score, narrative insights. Print-to-PDF and hand it to your sponsor, IC, or board — the platform turns discovery into a deliverable, not just a list.',
            },
            {
              icon: Users,
              title: 'Teams — shared dataroom, own outreach',
              desc: 'Invite teammates by email. Templates, products, projects, KB and prospects stay shared across the org; each member connects their own LinkedIn and inbox so the sequencer sends from the right account. Owner/admin/member roles, per-member channel inventory, branded invite emails via Resend.',
            },
            {
              icon: Reply,
              title: 'Bounce + complaint auto-handling',
              desc: 'Resend webhook (svix-validated) listens for bounces, complaints, and delivery delays. A bounced address auto-marks the prospect as contact_partial, clears the bad email so enrich can re-run, and cancels any downstream queued steps — no piling on a dead inbox. Audit-logged for compliance.',
            },
            {
              icon: TestTube2,
              title: 'Sample-to-self',
              desc: 'One-click end-to-end test: runs the full pipeline against you (Brave + LinkedIn enrichment on your own profile, render, send to your inbox). See what the system would write to a real prospect before you set up a single one.',
            },
            {
              icon: Pause,
              title: 'Caps + per-channel kill switch',
              desc: 'Daily send caps and warmup curves enforced server-side. Per-channel kill switch in /channels halts a misbehaving account in one click. Full audit log of every send, approval, edit, and pause.',
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

      <PublicFooter />
    </div>
  );
}
