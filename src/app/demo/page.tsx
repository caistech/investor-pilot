import Link from "next/link";
import PublicHeader from "@/components/layout/public-header";
import PublicFooter from "@/components/layout/public-footer";
import {
  ArrowRight,
  Calendar,
  Eye,
  Lock,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

export const metadata = {
  title: "Demo — InvestorPilot",
  description:
    "See InvestorPilot run on a real raise. 20-minute live screen-share, no slides, no auto-play video. Book a time below.",
};

const what_youll_see = [
  {
    icon: Sparkles,
    title: "Discovery + scoring against your live ICP",
    body: "We load your real Project or Product target into a sandbox tenant, run discovery against Brave + LinkedIn, and walk through how each candidate scored across the 5 dimensions.",
  },
  {
    icon: Users,
    title: "Enrichment, drafting, approvals",
    body: "Watch a Hunter.io email lookup land, watch a draft render with the courtesy contract structure, and see the /approvals workflow with fit score, tier badge, compliance check, and personalisation score.",
  },
  {
    icon: ShieldCheck,
    title: "Audit trail + bounce handling",
    body: "Every discovery, scoring, draft, approval, send, and bounce is written to audit_events. We'll pull the audit log for a recent campaign so you can see what your tax advisor or fund counsel would see at review time.",
  },
  {
    icon: Eye,
    title: "Your honest questions, no script",
    body: "The last third of the session is yours. Push on the data residency story, the model-training posture, the rate caps, the compliance hooks — anything you'd need to clear before deploying it.",
  },
];

const not_a_demo_video_because = [
  {
    title: "Live LLM calls cost money on every replay",
    body: "A recorded demo would either need fake data (which misleads) or rack up API costs every time someone watches (which forces a pre-canned, less useful version).",
  },
  {
    title: "The interesting parts are the questions",
    body: "Generic walkthroughs answer the questions the salesperson wanted answered, not the questions the operator actually has. A 20-minute live session is a better fit for an operator-grade tool.",
  },
  {
    title: "Email delivery is non-trivial",
    body: "The bounce / complaint / dead-inbox handling needs a real Resend webhook to demonstrate. We can't fake that in a video and have it look honest.",
  },
];

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1">
        {/* HERO */}
        <section className="max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="badge-green mb-4 inline-block">Live demo</div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            See it run on a real raise
          </h1>
          <p className="text-dark-300 text-lg max-w-2xl mx-auto">
            What this page is: how to book a 20-minute live demo of
            InvestorPilot. What you do here: pick a time below or send a
            short note. Why it matters: InvestorPilot drives live email and
            LinkedIn delivery against real prospects — you should see it
            work on your own ICP, not a pre-canned video, before deciding.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="mailto:dennis@corporateaisolutions.com?subject=InvestorPilot%20demo%20request&body=Hi%20Dennis%2C%0A%0AI%27d%20like%20to%20see%20InvestorPilot%20run%20on%20a%20real%20raise.%0A%0AICP%20I%27m%20raising%20for%20%2F%20selling%20into%3A%20%0AStage%20%2F%20round%20%2F%20product%3A%20%0ABest%20times%20%28AEST%29%3A%20%0A%0AThanks."
              className="btn-primary text-lg px-8 py-3 inline-flex items-center gap-2"
            >
              <Calendar className="w-5 h-5" />
              Email to book a demo
            </a>
            <Link
              href="/playbook"
              className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
            >
              Read how it works first
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-dark-400 text-sm mt-4">
            Typical reply: same business day, Australian east-coast hours.
          </p>
        </section>

        {/* WHAT YOU'LL SEE */}
        <section className="border-t border-white/5 py-20">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-3xl font-bold text-center mb-3">
              What you&apos;ll see in 20 minutes
            </h2>
            <p className="text-dark-300 text-center max-w-2xl mx-auto mb-12">
              Real ICP, real prospects, real audit log. No staged screenshots,
              no fake data, no rep-driven slides.
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              {what_youll_see.map((item) => (
                <div
                  key={item.title}
                  className="card flex gap-4 items-start"
                >
                  <item.icon className="w-6 h-6 text-corp-green-400 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-white font-semibold mb-2">
                      {item.title}
                    </h3>
                    <p className="text-dark-300 text-sm leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WHY NOT A DEMO VIDEO */}
        <section className="border-t border-white/5 py-20">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-2xl font-bold mb-3">
              Why there isn&apos;t a demo video
            </h2>
            <p className="text-dark-300 mb-8">
              Most B2B products auto-play a 90-second video here. We deliberately
              do not. Three reasons:
            </p>
            <ul className="space-y-6">
              {not_a_demo_video_because.map((item) => (
                <li key={item.title} className="flex gap-4 items-start">
                  <Lock className="w-5 h-5 text-corp-green-400 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-white font-semibold mb-1">
                      {item.title}
                    </h3>
                    <p className="text-dark-300 text-sm leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-white/5 py-16">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-2xl font-bold mb-3">Ready to see it?</h2>
            <p className="text-dark-300 mb-8">
              Send a 3-line email — what you&apos;re raising or selling, who
              your ICP is, your best window in AEST. We&apos;ll come back with
              a 20-minute slot inside one business day.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="mailto:dennis@corporateaisolutions.com?subject=InvestorPilot%20demo%20request"
                className="btn-primary inline-flex items-center gap-2"
              >
                <Calendar className="w-4 h-4" />
                Email to book a demo
              </a>
              <Link
                href="/pricing"
                className="btn-secondary inline-flex items-center gap-2"
              >
                Pricing
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
