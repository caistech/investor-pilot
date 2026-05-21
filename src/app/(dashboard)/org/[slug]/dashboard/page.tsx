// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Inbox, AlertCircle, Send, CheckCircle2, TrendingUp, Plug, BarChart3, Languages, Globe } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/types';
import type { PartnerStatus } from '@/lib/types';
import { HeygenHero } from '@/components/dashboard/heygen-hero';
import { OnboardingSteps } from '@/components/dashboard/onboarding-steps';
import { UsageBanner } from '@/components/dashboard/usage-banner';
import { SampleToSelf } from '@/components/dashboard/sample-to-self';
import { getMonthlyUsage } from '@/lib/usage/events';
import { computePoolSummary, type PoolPartner } from '@/lib/pool/summary';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <div className="text-center py-20"><p className="text-dark-400">Not authenticated</p></div>;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id, full_name, email')
    .single();

  // Org-level config the SampleToSelf component needs to decide whether to
  // prompt for LinkedIn URL before running. Fetched server-side so the
  // dashboard doesn't flash a "click to set up" CTA after the page mounts.
  const { data: org } = profile?.active_organisation_id
    ? await supabase
        .from('organisations')
        .select('sender_linkedin_url, sender_name, sender_role')
        .eq('id', profile.active_organisation_id)
        .single()
    : { data: null };

  if (!profile?.active_organisation_id) {
    return (
      <div className="text-center py-20">
        <h2>Welcome to InvestorPilot</h2>
        <p className="text-dark-400 mt-2">Setting up your organisation...</p>
      </div>
    );
  }

  const orgId = profile.active_organisation_id;

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

  // Featured Pool Summaries — surface up to 2 of the most-populated
  // projects/products with their headline language/region stats so the
  // operator (and their sponsor over their shoulder) sees the deliverable
  // exists without having to drill into /projects or /products first.
  // Skipped when total prospects < 5 (too thin to be meaningful).
  type FeaturedOwner = { id: string; name: string; kind: 'project' | 'product'; count: number };
  let featured: Array<{ owner: FeaturedOwner; summary: ReturnType<typeof computePoolSummary> }> = [];
  if ((totalPartners || 0) >= 5) {
    const [{ data: projectRows }, { data: productRows }] = await Promise.all([
      supabase.from('projects').select('id, name').eq('organisation_id', orgId).eq('is_active', true),
      supabase.from('products').select('id, name').eq('organisation_id', orgId).eq('is_active', true),
    ]);
    const owners: FeaturedOwner[] = [];
    for (const p of (projectRows || []) as Array<{ id: string; name: string }>) {
      const { count } = await supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('project_id', p.id);
      if ((count || 0) > 0) owners.push({ id: p.id, name: p.name, kind: 'project', count: count || 0 });
    }
    for (const p of (productRows || []) as Array<{ id: string; name: string }>) {
      const { count } = await supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('product_id', p.id);
      if ((count || 0) > 0) owners.push({ id: p.id, name: p.name, kind: 'product', count: count || 0 });
    }
    owners.sort((a, b) => b.count - a.count);
    const top = owners.slice(0, 2);
    const summaries = await Promise.all(top.map(async (o) => {
      const filter = o.kind === 'project' ? { col: 'project_id', val: o.id } : { col: 'product_id', val: o.id };
      const { data: partnersRaw } = await supabase
        .from('partners')
        .select('id, company_name, contact_name, weighted_score, category, status, source, network_distance, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
        .eq('organisation_id', orgId)
        .eq(filter.col, filter.val)
        .order('weighted_score', { ascending: false, nullsFirst: false })
        .limit(500);
      return { owner: o, summary: computePoolSummary((partnersRaw || []) as PoolPartner[], { kind: o.kind }) };
    }));
    featured = summaries;
  }

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

      {/* One-click self-diagnostic — runs the full pipeline against the
          operator themselves so they can see what the system writes before
          setting up real prospects. Gated on sender identity (renderer
          requires it); LinkedIn URL is captured by an inline modal inside
          the component if missing. */}
      {org?.sender_name && org?.sender_role && (
        <SampleToSelf
          hasSenderLinkedinUrl={!!org.sender_linkedin_url}
          operatorEmail={(profile.email as string) || user.email || ''}
        />
      )}

      {/* Usage banner — only renders at 80%+ on any cap */}
      <UsageBanner usage={await getMonthlyUsage(orgId)} />

      {/* Onboarding strip — 4 numbered steps with DB-detected completion */}
      <OnboardingSteps
        orgId={orgId}
        activeChannels={activeChannels || 0}
        partnersScored={partnersScored || 0}
        queuedApprovals={queuedApprovals || 0}
        weeklyReplies={weeklyReplies || 0}
        messagesSent={messagesSent || 0}
      />

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

      {/* Featured Pool Summaries — top 1-2 most-populated project/product
          summaries with the headline language/region narrative. The
          deliverable that goes in a sponsor's inbox. */}
      {featured.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-1 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-400" /> Pool Summary — your sponsor deliverable
          </h3>
          <p className="text-dark-500 text-sm mb-4">
            Auto-generated one-pager per project / product. Pass it on as-is to your sponsor, IC, or board. Print to PDF on the page itself.
          </p>
          <div className={`grid gap-4 ${featured.length > 1 ? 'md:grid-cols-2' : ''}`}>
            {featured.map(({ owner, summary }) => (
              <Link
                key={`${owner.kind}-${owner.id}`}
                href={owner.kind === 'project' ? `/projects/${owner.id}/pool` : `/products/${owner.id}/pool`}
                className="card-hover border-blue-500/20 hover:border-blue-500/40"
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-xs uppercase tracking-wide text-blue-400">
                    {owner.kind === 'project' ? 'Project Summary' : 'Product Summary'}
                  </span>
                  <span className="text-xs text-dark-500">View →</span>
                </div>
                <h4 className="truncate mb-3">{owner.name}</h4>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-dark-500 text-xs">Scored</div>
                    <div className="font-bold text-white">{summary.totals.discovered}</div>
                  </div>
                  <div>
                    <div className="text-dark-500 text-xs flex items-center gap-1">
                      <Languages className="w-3 h-3 text-purple-400" /> Non-EN
                    </div>
                    <div className="font-bold text-purple-300">{summary.non_english_count}</div>
                  </div>
                  <div>
                    <div className="text-dark-500 text-xs flex items-center gap-1">
                      <Globe className="w-3 h-3 text-blue-400" /> Regions
                    </div>
                    <div className="font-bold text-blue-300">{summary.geographic_distribution.length}</div>
                  </div>
                </div>
                {summary.top_region && (
                  <div className="mt-3 pt-3 border-t border-dark-800 text-xs text-dark-400">
                    Top region: <span className="text-white font-medium">{summary.top_region.region}</span> ({summary.top_region.count} {owner.kind === 'project' ? 'investors' : 'partners'})
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

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
