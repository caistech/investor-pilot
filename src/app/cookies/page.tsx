import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';

export const metadata = {
  title: 'Cookie Policy — InvestorPilot',
  description: 'Cookies used on the InvestorPilot platform.',
};

export default function CookiesPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <h1 className="mb-2">Cookie Policy</h1>
        <p className="text-dark-500 text-sm mb-10">Last updated: 13 May 2026 — DRAFT, pending counsel review</p>

        <div className="space-y-6 text-dark-200">
          <section>
            <h3 className="mb-2">What we use</h3>
            <p>
              InvestorPilot uses a small set of cookies, all functional in nature.
              We do not use advertising cookies or third-party tracking pixels.
            </p>
          </section>

          <section>
            <h3 className="mb-2">Functional cookies</h3>
            <ul className="list-disc list-outside ml-5 space-y-2">
              <li>
                <strong>Authentication session</strong> (Supabase Auth) — keeps you
                signed in. Cleared on sign-out or expiry.
              </li>
              <li>
                <strong>CSRF tokens</strong> — protect form submissions against
                cross-site request forgery.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2">No tracking</h3>
            <p>
              We do not use Google Analytics, Facebook Pixel, or comparable
              advertising / behavioural-tracking technologies.
            </p>
          </section>

          <section>
            <h3 className="mb-2">Managing cookies</h3>
            <p>
              You can clear cookies via your browser settings. Disabling authentication
              cookies will sign you out and prevent re-authentication.
            </p>
          </section>

          <section className="border-t border-dark-800 pt-6 mt-10">
            <p className="text-dark-500 text-xs">
              <strong>DRAFT NOTICE</strong> — This cookie policy is a working draft
              pending counsel review.
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
