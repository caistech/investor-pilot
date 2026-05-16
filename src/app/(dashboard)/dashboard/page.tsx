import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Inbox, AlertCircle, Send, CheckCircle2, TrendingUp, Plug } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/types';
import type { PartnerStatus } from '@/lib/types';
import { HeygenHero } from '@/components/dashboard/heygen-hero';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <div className="text-center py-20"><p className="text-dark-400">Not authenticated</p></div>;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id, full_name')
    .single();

  if (!profile?.organisation_id) {
    return (
      <div className="text-center py-20">
        <h2>Welcome to InvestorPilot</h2>
        <p className="text-dark-400 mt-2">Setting up your organisation...</p>
      </div>
    );
  }

  const orgId = profile.organisation_id;

  // Last 7 days for funnel
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  const [
    { count: totalPartners },
    { count: activeChannels },
    { count: queuedApprovals },
    { count: partnersScored },
    { count: contactsEnriched },
    { count: messagesSent },
    { count: meetingsBooked },
    { count: weeklyConnectsSent },
    { count: weeklyEmailsSent },
    { count: weeklyReplies },
    { data: actionItems },
  ] = await Promise.all([
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId),
    supabase.from('client_channels').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('status', 'active'),
    supabase.from('sequence_steps').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('status', 'queued_for_approval'),
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).gte('weighted_score', 0),
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).in('status', ['contact_found', 'contact_partial']),
    supabase.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).not('sent_at', 'is', null),
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).in('status', ['meeting_booked', 'qualified', 'closed_won']),
    supabase.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('channel', 'linkedin_connect').gte('sent_at', sevenDaysAgoIso),
    supabase.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('channel', 'email').gte('sent_at', sevenDaysAgoIso),
    supabase.from('inbound_messages').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).gte('received_at', sevenDaysAgoIso),
    supabase.from('partners').select('id, company_name, status, domain').eq('organisation_id', orgId).in('status', ['follow_up_due', 'contact_partial', 'draft_ready']).limit(8),
  ]);

  const stats = [
    { label: 'Prospects', value: totalPartners || 0, icon: TrendingUp, color: 'text-corp-green-400', href: '/partners' },
    { label: 'Active channels', value: activeChannels || 0, icon: Plug, color: 'text-blue-400', href: '/channels' },
    { label: 'Pending approval', value: queuedApprovals || 0, icon: Inbox, color: 'text-amber-400', href: '/approvals' },
    { label: 'Meetings booked', value: meetingsBooked || 0, icon: CheckCircle2, color: 'text-purple-400', href: '/partners?status=meeting_booked' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Dashboard</h1>
          <p className="text-dark-400 mt-1">Welcome back{profile.full_name ? `, ${profile.full_name}` : ''}</p>
        </div>
      </div>

      {/* AI-generated explainer video — dismissible, hidden until ready */}
      <HeygenHero />

      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="card-hover">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-dark-400 text-sm">{stat.label}</p>
                <p className="text-3xl font-bold mt-1">{stat.value}</p>
              </div>
              <stat.icon className={`w-8 h-8 ${stat.color} opacity-50`} />
            </div>
          </Link>
        ))}
      </div>

      {/* Weekly funnel */}
      <div className="mb-8">
        <h3 className="mb-4">This week&apos;s funnel (last 7 days)</h3>
        <div className="card">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FunnelStep label="LinkedIn connects" value={weeklyConnectsSent || 0} />
            <FunnelStep label="Emails sent" value={weeklyEmailsSent || 0} />
            <FunnelStep label="Replies received" value={weeklyReplies || 0} />
            <FunnelStep
              label="Reply rate"
              value={`${weeklyReplies && (weeklyConnectsSent || weeklyEmailsSent)
                ? Math.round((weeklyReplies / ((weeklyConnectsSent || 0) + (weeklyEmailsSent || 0))) * 100)
                : 0}%`}
            />
          </div>
        </div>
      </div>

      {/* Action items */}
      {actionItems && actionItems.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-4">Needs attention</h3>
          <div className="grid gap-3">
            {actionItems.map((item) => (
              <Link
                key={item.id}
                href={`/partners/${item.id}`}
                className="card-hover flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                  <span>{item.company_name}</span>
                </div>
                <span className={STATUS_COLORS[item.status as PartnerStatus]}>
                  {item.status.replace(/_/g, ' ')}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty state if no channels connected */}
      {(activeChannels || 0) === 0 && (
        <div className="card border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Plug className="w-6 h-6 text-amber-400 mt-1 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-amber-400">No channels connected</h4>
              <p className="text-dark-300 mt-1">
                Connect at least one LinkedIn or email account before you can send outreach.
              </p>
              <Link href="/channels" className="btn-primary inline-flex items-center gap-2 mt-4">
                <Plug className="w-4 h-4" />
                Connect a channel
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Empty state if no prospects */}
      {(totalPartners || 0) === 0 && (
        <div className="card text-center py-12">
          <p className="text-dark-400">No prospects yet. Start a discovery session.</p>
          <Link href="/discover" className="btn-primary inline-flex items-center gap-2 mt-4">
            <Send className="w-4 h-4" />
            Discover prospects
          </Link>
        </div>
      )}
    </div>
  );
}

function FunnelStep({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-dark-400 text-sm">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
