import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';

export const metadata = {
  title: 'Terms of Service — InvestorPilot',
  description: 'Terms governing use of the InvestorPilot platform.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <h1 className="mb-2">Terms of Service</h1>
        <p className="text-dark-500 text-sm mb-10">Last updated: 13 May 2026 — DRAFT, pending counsel review</p>

        <div className="space-y-6 text-dark-200">
          <section>
            <h3 className="mb-2">1. Agreement</h3>
            <p>
              These Terms govern your use of the InvestorPilot platform (the
              &ldquo;Service&rdquo;) operated by Corporate AI Solutions Pty Ltd.
              By creating an account or using the Service, you agree to be bound
              by these Terms.
            </p>
          </section>

          <section>
            <h3 className="mb-2">2. The Service</h3>
            <p>
              InvestorPilot is software that helps operators run direct outreach
              campaigns across LinkedIn and email. The Service includes prospect
              discovery, scoring, drafting assistance, send orchestration, and
              audit logging. The Service does not provide financial, legal, or
              regulatory advice.
            </p>
          </section>

          <section>
            <h3 className="mb-2">3. Operator responsibilities</h3>
            <p>You agree:</p>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>To comply with all applicable laws and regulations, including financial-services, anti-spam, and data-protection laws in your jurisdiction</li>
              <li>To obtain any licences, registrations, or authorisations required for your outreach activity</li>
              <li>Not to use the Service to send unlawful, deceptive, or harassing communications</li>
              <li>Not to circumvent the pre-send compliance filter, daily caps, or kill switch</li>
              <li>To maintain accurate sender-identity information on all messages</li>
              <li>To respect opt-out requests from recipients</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2">4. Acceptable use</h3>
            <p>
              You must not use the Service in connection with: spam; phishing or
              fraud; impersonation; harassment; promotion of illegal activity;
              circumvention of platform terms (LinkedIn, Gmail, Outlook); or any
              activity that would expose Corporate AI Solutions, Unipile, Resend,
              or our other sub-processors to legal or reputational harm.
            </p>
          </section>

          <section>
            <h3 className="mb-2">5. Account safety</h3>
            <p>
              The Service enforces conservative daily caps and warmup curves to
              protect connected accounts from third-party platform action. We do
              not guarantee that any third-party platform (LinkedIn, Gmail, Outlook)
              will not restrict, flag, or terminate your connected accounts. You
              accept that risk by connecting an account.
            </p>
          </section>

          <section>
            <h3 className="mb-2">6. Fees</h3>
            <p>
              Fee structure is documented separately during onboarding. During the
              pre-launch period, the Service may be provided without charge to
              selected operators.
            </p>
          </section>

          <section>
            <h3 className="mb-2">7. Intellectual property</h3>
            <p>
              Corporate AI Solutions retains all rights in the Service. You retain
              all rights in your data and content. You grant us a limited licence
              to process your data solely for the purpose of providing the Service.
            </p>
          </section>

          <section>
            <h3 className="mb-2">8. Disclaimer of warranties</h3>
            <p>
              The Service is provided &ldquo;as is&rdquo; without warranties of any
              kind. To the extent permitted by law, we disclaim all implied warranties.
            </p>
          </section>

          <section>
            <h3 className="mb-2">9. Limitation of liability</h3>
            <p>
              To the maximum extent permitted by law, our total liability arising
              out of or relating to these Terms is limited to the amount you have
              paid us in the twelve months preceding the claim. We are not liable
              for indirect, consequential, or punitive damages.
            </p>
          </section>

          <section>
            <h3 className="mb-2">10. Termination</h3>
            <p>
              Either party may terminate this agreement at any time with reasonable
              notice. On termination, your access to the Service ends. We may
              retain audit logs as required by applicable law.
            </p>
          </section>

          <section>
            <h3 className="mb-2">11. Governing law</h3>
            <p>
              These Terms are governed by the laws of Australia. Disputes will be
              subject to the exclusive jurisdiction of Australian courts.
            </p>
          </section>

          <section>
            <h3 className="mb-2">12. Changes</h3>
            <p>
              We may update these Terms from time to time. Material changes will
              be communicated to active operators with reasonable notice.
            </p>
          </section>

          <section>
            <h3 className="mb-2">13. Contact</h3>
            <p>
              <a href="mailto:dennis@corporateaisolutions.com" className="text-corp-green-400 hover:text-corp-green-300">
                dennis@corporateaisolutions.com
              </a>
            </p>
          </section>

          <section className="border-t border-dark-800 pt-6 mt-10">
            <p className="text-dark-500 text-xs">
              <strong>DRAFT NOTICE</strong> — These Terms are a working draft pending
              counsel review. The final version may differ; operators relying on the
              platform during the pre-launch review period should contact us for the
              current operative version.
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
