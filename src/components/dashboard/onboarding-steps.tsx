import Link from 'next/link';
import {
  CheckCircle2, Circle, ArrowRight, Settings, Package, Briefcase, Plug, Search, Inbox, MessageSquare,
  TrendingUp, Coins,
} from 'lucide-react';
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
 * Dashboard onboarding strip with the dual Products/Projects choice
 * surfaced as the first decision the operator makes. Layout:
 *
 *   Pick your discovery path  →  [Products (Sales)] [Projects (Funding)]
 *   Set up basics             →  [Settings] [Channels]
 *   Run outreach              →  [Discover] [Approvals] [Outreach]
 *
 * Each path card shows status of THAT specific path (so an operator
 * running both raises and sales can see both progress bars). Operators
 * only need to complete one path to unlock workflow.
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

  // Path status: 3 sub-checks per path (exists / pitched / rubric).
  const productPathSteps = [setup.hasActiveProduct, setup.productPitchConfigured, setup.rubricConfigured].filter(Boolean).length;
  const projectPathSteps = [setup.hasActiveProject, setup.projectThesisConfigured, setup.projectRubricConfigured].filter(Boolean).length;
  const productPathStatus: Status = productPathSteps === 3 ? 'done' : productPathSteps > 0 ? 'in_progress' : 'todo';
  const projectPathStatus: Status = projectPathSteps === 3 ? 'done' : projectPathSteps > 0 ? 'in_progress' : 'todo';

  // Basics
  const settingsStatus: Status = setup.senderConfigured ? 'done' : 'todo';
  const channelsStatus: Status = setup.channelConnected ? 'done' : 'todo';

  // Workflow
  const discoverStatus: Status = partnersScored >= 5 ? 'done' : partnersScored > 0 ? 'in_progress' : 'todo';
  const approveStatus: Status = messagesSent > 0 ? 'done' : queuedApprovals > 0 ? 'in_progress' : 'todo';
  const trackStatus: Status = weeklyReplies > 0 ? 'done' : messagesSent > 0 ? 'in_progress' : 'todo';

  return (
    <div className="card mb-8">
      <div className="mb-5">
        <h3>Get started — pick your discovery path</h3>
        <p className="text-dark-400 text-sm mt-1">
          InvestorPilot runs in two modes. <strong className="text-dark-200">Use one or both</strong> — they share the same workflow underneath. Click a card to set it up.
        </p>
      </div>

      {/* Dual path picker — the headline choice */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <PathCard
          icon={Package}
          tone="emerald"
          title="Products"
          subtitle="for SALES"
          tagline="Find customers, channel partners, resellers"
          description="Set up a product profile and the engine finds the BUYERS who'd pay for it — HR directors, VPs of ops, distribution partners, integration partners. Use for SaaS sales, BD, partnership outreach."
          examples="Examples: SaaS sales, channel partner BD, reseller recruitment"
          progressLabel={`${productPathSteps}/3 configured`}
          status={productPathStatus}
          href="/products"
          cta={productPathSteps === 0 ? 'Set up your first product' : productPathSteps === 3 ? 'Review products' : 'Finish setting up'}
        />
        <PathCard
          icon={Briefcase}
          tone="amber"
          title="Projects"
          subtitle="for FUNDING"
          tagline="Find investors, lenders, capital providers"
          description="Set up a project (raise, fund, facility) and the engine finds the CAPITAL PROVIDERS who'd commit — VC partners, family offices, private credit funds, LPs. Use for fundraising, debt syndication, LP outreach."
          examples="Examples: VC raise, debt syndication, LP commitment, fund formation"
          progressLabel={`${projectPathSteps}/3 configured`}
          status={projectPathStatus}
          href="/projects"
          cta={projectPathSteps === 0 ? 'Set up your first project' : projectPathSteps === 3 ? 'Review projects' : 'Finish setting up'}
        />
      </div>

      {/* Basics that BOTH paths need */}
      <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-2">Set up basics (both paths need these)</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <BasicCard
          icon={Settings}
          title="Settings"
          status={settingsStatus}
          blurb={setup.senderConfigured ? 'Sender name and role configured.' : 'Set your name and role — used to sign every outbound message.'}
          href="/settings"
          cta={setup.senderConfigured ? 'Review settings' : 'Set sender identity'}
        />
        <BasicCard
          icon={Plug}
          title="Channels"
          status={channelsStatus}
          blurb={setup.channelConnected ? `${activeChannels} active channel${activeChannels === 1 ? '' : 's'}.` : 'Connect a LinkedIn or email account via Unipile.'}
          href="/channels"
          cta={setup.channelConnected ? 'Manage channels' : 'Connect a channel'}
        />
      </div>

      {/* Workflow that runs for either path */}
      <p className="text-[10px] uppercase tracking-wider text-dark-500 mb-2">Run outreach (works for either path)</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <BasicCard
          icon={Search}
          title="Discover"
          status={discoverStatus}
          blurb={discoverStatus === 'done' ? `${partnersScored} prospects scored.` : 'Run a discovery batch — finds + scores prospects against your ICP.'}
          href="/discover"
          cta={discoverStatus === 'done' ? 'Find more' : 'Start discovering'}
        />
        <BasicCard
          icon={Inbox}
          title="Approvals"
          status={approveStatus}
          blurb={queuedApprovals > 0
            ? `${queuedApprovals} draft${queuedApprovals === 1 ? '' : 's'} waiting.`
            : approveStatus === 'done'
              ? `${messagesSent} message${messagesSent === 1 ? '' : 's'} sent.`
              : 'Approve every draft before it goes out.'}
          href="/approvals"
          cta={queuedApprovals > 0 ? 'Review queue' : 'Open approvals'}
        />
        <BasicCard
          icon={MessageSquare}
          title="Outreach"
          status={trackStatus}
          blurb={weeklyReplies > 0
            ? `${weeklyReplies} repl${weeklyReplies === 1 ? 'y' : 'ies'} this week.`
            : 'Replies + follow-ups land here.'}
          href="/outreach"
          cta={weeklyReplies > 0 ? 'Open inbox' : 'View outreach'}
        />
      </div>
    </div>
  );
}

interface PathCardProps {
  icon: typeof Package;
  tone: 'emerald' | 'amber';
  title: string;
  subtitle: string;
  tagline: string;
  description: string;
  examples: string;
  progressLabel: string;
  status: Status;
  href: string;
  cta: string;
}

function PathCard({ icon: Icon, tone, title, subtitle, tagline, description, examples, progressLabel, status, href, cta }: PathCardProps) {
  const toneClasses = tone === 'emerald'
    ? {
      border: status === 'done' ? 'border-corp-green-500/40' : status === 'in_progress' ? 'border-corp-green-500/30' : 'border-corp-green-500/20',
      bg: 'bg-corp-green-500/5 hover:bg-corp-green-500/10',
      subtitle: 'text-corp-green-400',
      icon: 'text-corp-green-400',
      cta: 'text-corp-green-300 group-hover:text-corp-green-200',
    }
    : {
      border: status === 'done' ? 'border-amber-500/40' : status === 'in_progress' ? 'border-amber-500/30' : 'border-amber-500/20',
      bg: 'bg-amber-500/5 hover:bg-amber-500/10',
      subtitle: 'text-amber-400',
      icon: 'text-amber-400',
      cta: 'text-amber-300 group-hover:text-amber-200',
    };

  const StatusIcon = status === 'done' ? CheckCircle2 : status === 'in_progress' ? TrendingUp : Coins;

  return (
    <Link href={href} className={`group block rounded-lg border ${toneClasses.border} ${toneClasses.bg} p-5 transition-colors`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Icon className={`w-6 h-6 ${toneClasses.icon}`} />
          <div>
            <p className="text-lg font-semibold text-white leading-tight">{title}</p>
            <p className={`text-[11px] uppercase tracking-wider font-bold ${toneClasses.subtitle}`}>{subtitle}</p>
          </div>
        </div>
        <StatusIcon className={`w-5 h-5 ${status === 'done' ? 'text-corp-green-400' : toneClasses.icon}`} />
      </div>
      <p className={`text-sm font-medium ${toneClasses.subtitle} mb-2`}>{tagline}</p>
      <p className="text-dark-300 text-sm mb-3 leading-relaxed">{description}</p>
      <p className="text-dark-500 text-xs italic mb-4">{examples}</p>
      <div className="flex items-center justify-between pt-3 border-t border-dark-700">
        <span className="text-dark-500 text-xs">{progressLabel}</span>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${toneClasses.cta}`}>
          {cta}
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </Link>
  );
}

interface BasicCardProps {
  icon: typeof Settings;
  title: string;
  status: Status;
  blurb: string;
  href: string;
  cta: string;
}

function BasicCard({ icon: Icon, title, status, blurb, href, cta }: BasicCardProps) {
  return (
    <Link
      href={href}
      className={`group block rounded-lg border p-3 transition-colors ${
        status === 'done'
          ? 'border-corp-green-500/30 bg-corp-green-500/5 hover:bg-corp-green-500/10'
          : status === 'in_progress'
            ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
            : 'border-dark-700 bg-dark-900 hover:border-dark-600'
      }`}
    >
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon
            className={`w-4 h-4 ${
              status === 'done' ? 'text-corp-green-400' : status === 'in_progress' ? 'text-amber-400' : 'text-dark-500'
            }`}
          />
          <p className="font-semibold text-white text-sm">{title}</p>
        </div>
        {status === 'done' ? (
          <CheckCircle2 className="w-4 h-4 text-corp-green-400" />
        ) : (
          <Circle className={`w-4 h-4 ${status === 'in_progress' ? 'text-amber-400' : 'text-dark-600'}`} />
        )}
      </div>
      <p className="text-dark-400 text-xs mb-2 leading-relaxed">{blurb}</p>
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          status === 'done'
            ? 'text-corp-green-400 group-hover:text-corp-green-300'
            : status === 'in_progress'
              ? 'text-amber-400 group-hover:text-amber-300'
              : 'text-dark-300 group-hover:text-white'
        }`}
      >
        {cta}
        <ArrowRight className="w-3 h-3" />
      </span>
    </Link>
  );
}
