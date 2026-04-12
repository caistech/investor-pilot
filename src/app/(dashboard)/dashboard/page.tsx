import { createClient, createServiceClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Plus, AlertCircle, Clock, Users, FileText, Zap } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/types';
import type { PartnerStatus } from '@/lib/types';
import { slugify } from '@/lib/utils';

export default async function DashboardPage() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <div className="text-center py-20"><p className="text-dark-400">Not authenticated</p></div>;

  let { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id, full_name')
    .single();

  // Auto-provision org + profile on first login (password signup skips /auth/callback)
  if (!profile?.organisation_id) {
    const admin = createServiceClient();
    const meta = user.user_metadata;
    const orgName = meta?.org_name || meta?.full_name || 'My Organisation';

    const { data: org } = await admin
      .from('organisations')
      .insert({
        name: orgName,
        slug: slugify(orgName) + '-' + Date.now().toString(36),
        owner_id: user.id,
      })
      .select()
      .single();

    if (org) {
      if (!profile) {
        await admin.from('profiles').insert({
          id: user.id,
          organisation_id: org.id,
          full_name: meta?.full_name || null,
          email: user.email,
          role: 'owner',
        });
      } else {
        await admin.from('profiles').update({ organisation_id: org.id }).eq('id', user.id);
      }

      // Re-fetch profile
      const { data: refreshed } = await supabase
        .from('profiles')
        .select('organisation_id, full_name')
        .single();
      profile = refreshed;
    }
  }

  if (!profile?.organisation_id) {
    return (
      <div className="text-center py-20">
        <h2>Welcome to InvestorPilot</h2>
        <p className="text-dark-400 mt-2">Setting up your organisation...</p>
      </div>
    );
  }

  const orgId = profile.organisation_id;

  const [
    { count: totalPartners },
    { count: contactsFound },
    { count: draftsReady },
    { count: activeSessions },
    { data: recentPartners },
    { data: actionItems },
  ] = await Promise.all([
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId),
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).in('status', ['contact_found', 'contact_partial']),
    supabase.from('partners').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('status', 'draft_ready'),
    supabase.from('agent_sessions').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId).eq('status', 'active'),
    supabase.from('partners').select('company_name, status, weighted_score, domain').eq('organisation_id', orgId).order('last_updated_at', { ascending: false }).limit(5),
    supabase.from('partners').select('id, company_name, status, domain').eq('organisation_id', orgId).in('status', ['follow_up_due', 'contact_partial', 'draft_ready']).limit(10),
  ]);

  const stats = [
    { label: 'Prospects Discovered', value: totalPartners || 0, icon: Users, color: 'text-corp-green-400' },
    { label: 'Contacts Enriched', value: contactsFound || 0, icon: Zap, color: 'text-blue-400' },
    { label: 'Drafts Ready', value: draftsReady || 0, icon: FileText, color: 'text-amber-400' },
    { label: 'Active Sessions', value: activeSessions || 0, icon: Clock, color: 'text-purple-400' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Dashboard</h1>
          <p className="text-dark-400 mt-1">Welcome back{profile.full_name ? `, ${profile.full_name}` : ''}</p>
        </div>
        <Link href="/sessions" className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Session
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-dark-400 text-sm">{stat.label}</p>
                <p className="text-3xl font-bold mt-1">{stat.value}</p>
              </div>
              <stat.icon className={`w-8 h-8 ${stat.color} opacity-50`} />
            </div>
          </div>
        ))}
      </div>

      {/* Action Items */}
      {actionItems && actionItems.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-4">Needs Attention</h3>
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

      {/* Recent Partners */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3>Recent Prospects</h3>
          <Link href="/partners" className="text-corp-green-400 text-sm hover:text-corp-green-300">
            View all
          </Link>
        </div>
        {recentPartners && recentPartners.length > 0 ? (
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Company</th>
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Score</th>
                  <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentPartners.map((p, i) => (
                  <tr key={i} className="border-b border-dark-800 last:border-0">
                    <td className="px-6 py-3">{p.company_name}</td>
                    <td className="px-6 py-3">{p.weighted_score ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={STATUS_COLORS[p.status as PartnerStatus]}>
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card text-center py-12">
            <p className="text-dark-400">No prospects yet. Start a session to discover investor prospects.</p>
            <Link href="/sessions" className="btn-primary inline-flex items-center gap-2 mt-4">
              <Plus className="w-4 h-4" />
              Start First Session
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
