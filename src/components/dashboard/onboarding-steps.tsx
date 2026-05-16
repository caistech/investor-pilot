import Link from 'next/link';
import { CheckCircle2, Circle, ArrowRight, Settings, Package, Plug, Search, Inbox, MessageSquare } from 'lucide-react';
import { getSetupState } from '@/lib/onboarding/setup-state';

interface OnboardingStepsProps {
  orgId: string;
  activeChannels: number;
  partnersScored: number;
  queuedApprovals: number;
  weeklyReplies: number;
  messagesSent: number;
}

type Status = 'done' | 'in_progress' | 'todo';

/**
 * Dashboard onboarding strip — 6 numbered steps mirroring the sidebar's
 * navbar groups exactly, so the eye flows from sidebar to dashboard to
 * action with zero translation:
 *
 *   Set up group  →  Settings (1)  →  Products (2)  →  Channels (3)
 *   Workflow      →  Discover (4)  →  Approvals (5) →  Outreach (6)
 *
 * Each card detects its own status from DB state and shows a contextual
 * CTA. Rendered in two rows of three on desktop so the "set up before
 * workflow" boundary is visually obvious.
 */
export async function OnboardingSteps({
  orgId,
  activeChannels,
  partnersScored,
  queuedApprovals,
  weeklyReplies,
  messagesSent,
}: OnboardingStepsProps) {
  const setup = await getSetupState(orgId);

  // Step 1 — Settings: sender identity (name + role)
  const settingsStatus: Status = setup.senderConfigured ? 'done' : 'todo';

  // Step 2 — Products: needs pitch + rubric + sequence to be fully configured.
  // Show "in progress" if product exists but isn't fully configured.
  const productsDone = setup.hasActiveProduct && setup.productPitchConfigured && setup.rubricConfigured && setup.sequenceConfigured;
  const productsAny = setup.hasActiveProduct;
  const productsStatus: Status = productsDone ? 'done' : productsAny ? 'in_progress' : 'todo';

  // Step 3 — Channels: at least one active.
  const channelsStatus: Status = setup.channelConnected ? 'done' : 'todo';

  // Step 4 — Discover: at least one scored prospect.
  const discoverStatus: Status = partnersScored >= 5 ? 'done' : partnersScored > 0 ? 'in_progress' : 'todo';

  // Step 5 — Approvals: at least one sent (=approved + sent).
  const approveStatus: Status = messagesSent > 0 ? 'done' : queuedApprovals > 0 ? 'in_progress' : 'todo';

  // Step 6 — Outreach: at least one reply this week.
  const trackStatus: Status = weeklyReplies > 0 ? 'done' : messagesSent > 0 ? 'in_progress' : 'todo';

  // Smart per-card blurbs + CTAs.
  const productsBlurb = productsDone
    ? 'Pitch, ICP rubric and outreach sequence all generated.'
    : !setup.hasActiveProduct
      ? 'Create your first product so the engine knows what to pitch.'
      : !setup.productPitchConfigured
        ? 'Add a one-line description or pitch to your product.'
        : !setup.rubricConfigured
          ? 'Generate the ICP scoring rubric on the product card.'
          : !setup.sequenceConfigured
            ? 'Generate the outreach sequence on the product card.'
            : 'Configured — open to edit anytime.';

  const productsCta = productsDone
    ? 'Review products'
    : !setup.hasActiveProduct
      ? 'Add product'
      : !setup.rubricConfigured
        ? 'Generate rubric'
        : !setup.sequenceConfigured
          ? 'Generate sequence'
          : 'Open product';

  const setupSteps = [
    {
      n: 1,
      title: 'Settings',
      blurb: setup.senderConfigured
        ? 'Sender name and role configured.'
        : 'Set your name and role — used to sign every outbound message.',
      href: '/settings',
      cta: setup.senderConfigured ? 'Review settings' : 'Set sender identity',
      icon: Settings,
      status: settingsStatus,
    },
    {
      n: 2,
      title: 'Products',
      blurb: productsBlurb,
      href: '/products',
      cta: productsCta,
      icon: Package,
      status: productsStatus,
    },
    {
      n: 3,
      title: 'Channels',
      blurb: setup.channelConnected
        ? `${activeChannels} active channel${activeChannels === 1 ? '' : 's'}.`
        : 'Connect a LinkedIn or email account via Unipile — one-click OAuth.',
      href: '/channels',
      cta: setup.channelConnected ? 'Manage channels' : 'Connect a channel',
      icon: Plug,
      status: channelsStatus,
    },
  ];

  const workflowSteps = [
    {
      n: 4,
      title: 'Discover',
      blurb: discoverStatus === 'done'
        ? `${partnersScored} prospects scored. Run again anytime to add more.`
        : 'Run a discovery batch — finds and scores investor prospects against your ICP.',
      href: '/discover',
      cta: discoverStatus === 'done' ? 'Find more' : 'Start discovering',
      icon: Search,
      status: discoverStatus,
    },
    {
      n: 5,
      title: 'Approvals',
      blurb: queuedApprovals > 0
        ? `${queuedApprovals} draft${queuedApprovals === 1 ? '' : 's'} waiting for your sign-off.`
        : approveStatus === 'done'
          ? `${messagesSent} message${messagesSent === 1 ? '' : 's'} sent so far.`
          : 'Approve every draft before it goes out. Nothing sends without your OK.',
      href: '/approvals',
      cta: queuedApprovals > 0 ? 'Review queue' : 'Open approvals',
      icon: Inbox,
      status: approveStatus,
    },
    {
      n: 6,
      title: 'Outreach',
      blurb: weeklyReplies > 0
        ? `${weeklyReplies} repl${weeklyReplies === 1 ? 'y' : 'ies'} this week.`
        : 'Replies land here. Follow-ups get queued automatically after 7 days.',
      href: '/outreach',
      cta: weeklyReplies > 0 ? 'Open inbox' : 'View outreach',
      icon: MessageSquare,
      status: trackStatus,
    },
  ];

  return (
    <div className="card mb-8">
      <div className="mb-4">
        <h3>Get started in 6 steps</h3>
        <p className="text-dark-400 text-sm mt-1">Same order as the sidebar — work top-to-bottom, left-to-right.</p>
      </div>

      <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-2">Set up</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {setupSteps.map((s) => <StepCard key={s.n} step={s} />)}
      </div>

      <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-2">Run outreach</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {workflowSteps.map((s) => <StepCard key={s.n} step={s} />)}
      </div>
    </div>
  );
}

interface StepCardData {
  n: number;
  title: string;
  blurb: string;
  href: string;
  cta: string;
  icon: typeof Settings;
  status: Status;
}

function StepCard({ step }: { step: StepCardData }) {
  return (
    <Link
      href={step.href}
      className={`group block rounded-lg border p-4 transition-colors ${
        step.status === 'done'
          ? 'border-corp-green-500/30 bg-corp-green-500/5 hover:bg-corp-green-500/10'
          : step.status === 'in_progress'
            ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
            : 'border-dark-700 bg-dark-900 hover:border-dark-600'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
              step.status === 'done'
                ? 'bg-corp-green-500/20 text-corp-green-400'
                : step.status === 'in_progress'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-dark-700 text-dark-400'
            }`}
          >
            {step.n}
          </span>
          <step.icon
            className={`w-4 h-4 ${
              step.status === 'done'
                ? 'text-corp-green-400'
                : step.status === 'in_progress'
                  ? 'text-amber-400'
                  : 'text-dark-500'
            }`}
          />
        </div>
        {step.status === 'done' ? (
          <CheckCircle2 className="w-4 h-4 text-corp-green-400" />
        ) : (
          <Circle className={`w-4 h-4 ${step.status === 'in_progress' ? 'text-amber-400' : 'text-dark-600'}`} />
        )}
      </div>
      <p className="font-semibold text-white">{step.title}</p>
      <p className="text-dark-400 text-xs mt-1 mb-3 leading-relaxed">{step.blurb}</p>
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          step.status === 'done'
            ? 'text-corp-green-400 group-hover:text-corp-green-300'
            : step.status === 'in_progress'
              ? 'text-amber-400 group-hover:text-amber-300'
              : 'text-dark-300 group-hover:text-white'
        }`}
      >
        {step.cta}
        <ArrowRight className="w-3 h-3" />
      </span>
    </Link>
  );
}
