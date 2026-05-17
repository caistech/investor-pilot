import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';

export const metadata = {
  title: 'About — InvestorPilot',
  description: 'About InvestorPilot, the multi-channel direct outreach platform.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <h1 className="mb-6">About InvestorPilot</h1>

        <div className="prose prose-invert max-w-none space-y-5 text-dark-200">
          <p>
            InvestorPilot is multi-channel direct outreach software for operators
            who run their own campaigns. It targets two use cases from the same
            workflow — <strong>Projects</strong> for fundraising (VCs, family
            offices, private credit funds, LPs) and <strong>Products</strong>{' '}
            for sales (buyers, channel partners, integration partners). One
            pipeline handles discovery, scoring, enrichment, drafting,
            approval, sending, and reply tracking across LinkedIn and email
            from a single workspace.
          </p>

          <h3 className="mt-8">Built by</h3>
          <p>
            <strong>Corporate AI Solutions Pty Ltd</strong> — based in Australia,
            building software for operators who need direct, auditable, compliance-aware
            outreach tooling. Founded by Dennis McMahon.
          </p>

          <h3 className="mt-8">What InvestorPilot is</h3>
          <ul className="list-disc list-outside ml-5 space-y-2">
            <li>Software you run. Discovery and scoring are AI-assisted; every send is human-approved.</li>
            <li>Dual-purpose. Same pipeline runs investor outreach for a raise and sales outreach for a product — only the templates, tone, and ICP shift per target.</li>
            <li>Multi-channel. LinkedIn connection requests and DMs (via Unipile) + email (via Resend).</li>
            <li>Tier-modulated. High-fit prospects get a direct ask; low-fit get exploratory framing.</li>
            <li>Auto-localised. Non-English prospects get their first message in their native language (14 supported — Vietnamese, Korean, Japanese, Chinese, Thai, Indonesian, Arabic, Portuguese, Spanish, French, German, Italian, Turkish, Russian). English original preserved for one-click operator review in /approvals.</li>
            <li>Sponsor-deliverable. Every Project and Product generates a one-page Pool Summary — scored count, score-tier histogram, geographic + language distribution, top 10 by score, narrative insights. Print to PDF and hand to your sponsor, IC, or board as-is.</li>
            <li>Team-ready. Invite teammates by email; shared dataroom (templates, products, projects, KB, prospects) with per-member outreach (each member sends from their own LinkedIn + inbox). Owner / admin / member roles, audit-logged.</li>
            <li>Audit-logged. Every action — discovery, scoring, approval, send, bounce, manual reply mark — written to an audit trail.</li>
            <li>Compliance-aware. Per-product compliance rulesets (standard + finance_au_senior_debt built in) block unapproved language pre-send.</li>
            <li>Bounce-aware. Resend webhook auto-marks bounced contacts as contact_partial, clears the bad email so enrich can retry on a fresh address, and cancels pending downstream steps so the platform doesn&apos;t pile sends onto a dead inbox.</li>
            <li>Operator-controlled. Daily caps, warmup curves, and a per-channel kill switch live on the platform, not on the third party.</li>
          </ul>

          <h3 className="mt-8">What InvestorPilot is not</h3>
          <ul className="list-disc list-outside ml-5 space-y-2">
            <li>Not a financial-advice service. The platform makes no investment recommendations.</li>
            <li>Not a placement agent. Operators communicate with their own prospects from their own accounts.</li>
            <li>Not a CRM. It is an outreach automation surface that complements existing CRM systems.</li>
            <li>Not a substitute for legal or regulatory review. Operators remain responsible for compliance in their jurisdiction.</li>
          </ul>

          <h3 className="mt-8">Status</h3>
          <p>
            InvestorPilot is in active development. The site is live but unadvertised
            during a pre-launch counsel review. Documentation, terms, and operator-facing
            policies are being finalised in parallel with this review.
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
