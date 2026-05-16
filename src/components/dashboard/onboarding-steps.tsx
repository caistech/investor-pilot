import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { CheckCircle2, Circle, ArrowRight, Settings, Search, Inbox, MessageSquare } from 'lucide-react';

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
 * Dashboard onboarding strip — 4 numbered steps showing the operator's path
 * from zero-state to active outreach. Each step detects its own completion
 * from DB state (sender filled? products scored? etc). Renders below the
 * Heygen hero and above the headline stats grid.
 */
export async function OnboardingSteps({
  orgId,
  activeChannels,
  partnersScored,
  queuedApprovals,
  weeklyReplies,
  messagesSent,
}: OnboardingStepsProps) {
  const supabase = createClient();

  const [{ data: org }, { data: primaryProduct }, { count: sequenceTemplateCount }] = await Promise.all([
    supabase.from('organisations').select('sender_name').eq('id', orgId).maybeSingle(),
    supabase
      .from('products')
      .select('product_pitch, scoring_rubric')
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sequence_templates')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('is_active', true),
  ]);

  const senderConfigured = !!org?.sender_name;
  const productConfigured = !!primaryProduct?.product_pitch && !!primaryProduct?.scoring_rubric;
  const channelConnected = activeChannels > 0;
  const sequenceConfigured = (sequenceTemplateCount ?? 0) > 0;
  const setupDone = senderConfigured && productConfigured && channelConnected && sequenceConfigured;
  const setupProgress = [senderConfigured, productConfigured, channelConnected, sequenceConfigured].filter(Boolean).length;

  const setupStatus: Status = setupDone ? 'done' : setupProgress > 0 ? 'in_progress' : 'todo';
  const discoverStatus: Status = partnersScored >= 5 ? 'done' : partnersScored > 0 ? 'in_progress' : 'todo';
  const approveStatus: Status = messagesSent > 0 ? 'done' : queuedApprovals > 0 ? 'in_progress' : 'todo';
  const trackStatus: Status = weeklyReplies > 0 ? 'done' : messagesSent > 0 ? 'in_progress' : 'todo';

  const steps = [
    {
      n: 1,
      title: 'Set up',
      blurb: setupDone
        ? 'Sender, product (pitch + scoring rubric), channel and outreach sequence are all configured.'
        : !productConfigured && senderConfigured
          ? `${setupProgress}/4 — next: open your product and generate the ICP scoring rubric.`
          : !sequenceConfigured && productConfigured && senderConfigured
            ? `${setupProgress}/4 — last step: generate your outreach sequence from your product.`
            : `${setupProgress}/4 configured — sender, product (pitch + scoring rubric), channel, outreach sequence.`,
      href: !productConfigured && senderConfigured
        ? '/products'
        : !sequenceConfigured && productConfigured && senderConfigured
          ? '/settings/templates'
          : '/settings',
      cta: setupDone
        ? 'Review setup'
        : !productConfigured && senderConfigured
          ? 'Generate ICP rubric'
          : !sequenceConfigured && productConfigured && senderConfigured
            ? 'Generate sequence'
            : 'Finish setup',
      icon: Settings,
      status: setupStatus,
    },
    {
      n: 2,
      title: 'Find investors',
      blurb: discoverStatus === 'done'
        ? `${partnersScored} prospects scored. Run discovery anytime to add more.`
        : 'Run a discovery batch to find and score investor prospects.',
      href: '/discover',
      cta: discoverStatus === 'done' ? 'Find more' : 'Start discovering',
      icon: Search,
      status: discoverStatus,
    },
    {
      n: 3,
      title: 'Review & approve',
      blurb: queuedApprovals > 0
        ? `${queuedApprovals} draft${queuedApprovals === 1 ? '' : 's'} waiting for your sign-off.`
        : approveStatus === 'done'
          ? `${messagesSent} message${messagesSent === 1 ? '' : 's'} sent so far.`
          : 'Approve drafts before they go out. Nothing sends without your OK.',
      href: '/approvals',
      cta: queuedApprovals > 0 ? 'Review queue' : 'Open approvals',
      icon: Inbox,
      status: approveStatus,
    },
    {
      n: 4,
      title: 'Track replies',
      blurb: weeklyReplies > 0
        ? `${weeklyReplies} repl${weeklyReplies === 1 ? 'y' : 'ies'} this week — open the inbox to respond.`
        : 'Replies land here. Follow-ups get queued automatically after 7 days.',
      href: '/outreach',
      cta: weeklyReplies > 0 ? 'Open inbox' : 'View outreach',
      icon: MessageSquare,
      status: trackStatus,
    },
  ];

  return (
    <div className="card mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3>Get started in 4 steps</h3>
          <p className="text-dark-400 text-sm mt-1">Each step unlocks the next. Work through them in order on your first run.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s) => (
          <Link
            key={s.n}
            href={s.href}
            className={`group block rounded-lg border p-4 transition-colors ${
              s.status === 'done'
                ? 'border-corp-green-500/30 bg-corp-green-500/5 hover:bg-corp-green-500/10'
                : s.status === 'in_progress'
                  ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                  : 'border-dark-700 bg-dark-900 hover:border-dark-600'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    s.status === 'done'
                      ? 'bg-corp-green-500/20 text-corp-green-400'
                      : s.status === 'in_progress'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-dark-700 text-dark-400'
                  }`}
                >
                  {s.n}
                </span>
                <s.icon
                  className={`w-4 h-4 ${
                    s.status === 'done'
                      ? 'text-corp-green-400'
                      : s.status === 'in_progress'
                        ? 'text-amber-400'
                        : 'text-dark-500'
                  }`}
                />
              </div>
              {s.status === 'done' ? (
                <CheckCircle2 className="w-4 h-4 text-corp-green-400" />
              ) : (
                <Circle className={`w-4 h-4 ${s.status === 'in_progress' ? 'text-amber-400' : 'text-dark-600'}`} />
              )}
            </div>
            <p className="font-semibold text-white">{s.title}</p>
            <p className="text-dark-400 text-xs mt-1 mb-3 leading-relaxed">{s.blurb}</p>
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${
                s.status === 'done'
                  ? 'text-corp-green-400 group-hover:text-corp-green-300'
                  : s.status === 'in_progress'
                    ? 'text-amber-400 group-hover:text-amber-300'
                    : 'text-dark-300 group-hover:text-white'
              }`}
            >
              {s.cta}
              <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
