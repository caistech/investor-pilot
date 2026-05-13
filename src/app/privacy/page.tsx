import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';

export const metadata = {
  title: 'Privacy Policy — InvestorPilot',
  description: 'How InvestorPilot handles personal data.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <h1 className="mb-2">Privacy Policy</h1>
        <p className="text-dark-500 text-sm mb-10">Last updated: 13 May 2026 — DRAFT, pending counsel review</p>

        <div className="space-y-6 text-dark-200">
          <section>
            <h3 className="mb-2">Who we are</h3>
            <p>
              InvestorPilot is operated by Corporate AI Solutions Pty Ltd
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy describes how we collect,
              use, and protect personal information when you use the InvestorPilot
              platform.
            </p>
          </section>

          <section>
            <h3 className="mb-2">Information we collect</h3>
            <p>From operators (users of the platform):</p>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>Authentication data: email address, password (hashed by Supabase Auth)</li>
              <li>Profile data: full name, role, organisation</li>
              <li>OAuth account references for LinkedIn, Gmail, and Outlook (we store identifiers, never passwords or tokens — tokens are held by Unipile under their security model)</li>
              <li>Usage data: pages visited, actions taken, audit log entries</li>
            </ul>
            <p className="mt-3">From prospects (people the operator chooses to contact):</p>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>Publicly available business information (company name, role, LinkedIn URL, public email when discovered via Hunter.io)</li>
              <li>Inbound messages received in response to operator outreach</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2">How we use information</h3>
            <ul className="list-disc list-outside ml-5 space-y-1">
              <li>To provide the InvestorPilot service to the operator</li>
              <li>To enforce daily-cap and warmup safety limits on connected channels</li>
              <li>To run the pre-send compliance filter against drafted messages</li>
              <li>To maintain an audit log for compliance and debug purposes</li>
              <li>To respond to support and compliance enquiries</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2">Sub-processors</h3>
            <p>
              We use the following sub-processors. Each operates under its own
              privacy and security policies, linked below.
            </p>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>Supabase — database, authentication, file storage</li>
              <li>Vercel — application hosting</li>
              <li>Anthropic / OpenRouter — language model inference for scoring and drafting</li>
              <li>Hunter.io — public email discovery</li>
              <li>Brave Search — web search for prospect discovery</li>
              <li>Resend — transactional email send</li>
              <li>Unipile — LinkedIn / Gmail / Outlook channel orchestration</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2">Data retention</h3>
            <p>
              Operator-account data is retained for the lifetime of the account.
              Audit log entries are retained indefinitely for compliance traceability.
              Prospect data is retained while it remains relevant to the operator&apos;s
              outreach workflow; operators may delete prospect records at any time.
            </p>
          </section>

          <section>
            <h3 className="mb-2">Your rights</h3>
            <p>
              Under the Australian Privacy Act 1988 (and applicable equivalent
              regulations in other jurisdictions), you have rights to access, correct,
              and request deletion of your personal information. Contact us at{' '}
              <a href="mailto:dennis@corporateaisolutions.com" className="text-corp-green-400 hover:text-corp-green-300">
                dennis@corporateaisolutions.com
              </a>{' '}
              to exercise these rights.
            </p>
          </section>

          <section>
            <h3 className="mb-2">Security</h3>
            <p>
              We use industry-standard security measures including encrypted
              transport (HTTPS), encrypted storage (Supabase), row-level security
              for tenant isolation, and OAuth-based channel authentication (we never
              hold raw social or email credentials).
            </p>
          </section>

          <section>
            <h3 className="mb-2">Contact</h3>
            <p>
              Privacy questions: <a href="mailto:dennis@corporateaisolutions.com" className="text-corp-green-400 hover:text-corp-green-300">dennis@corporateaisolutions.com</a>
            </p>
          </section>

          <section className="border-t border-dark-800 pt-6 mt-10">
            <p className="text-dark-500 text-xs">
              <strong>DRAFT NOTICE</strong> — This privacy policy is a working draft
              pending counsel review. The final version may differ; operators relying
              on the platform during the pre-launch review period should contact us
              for the current operative version.
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
