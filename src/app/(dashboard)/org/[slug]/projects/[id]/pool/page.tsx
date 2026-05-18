import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Globe, Languages, BarChart3, Sparkles, Users } from 'lucide-react';
import { computePoolSummary, type PoolPartner } from '@/lib/pool/summary';
import { PoolSummaryView } from '@/components/pool/pool-summary-view';

export const dynamic = 'force-dynamic';

export default async function ProjectSummaryPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .single();
  if (!profile?.organisation_id) notFound();

  const db = createServiceClient();
  const { data: project } = await db
    .from('projects')
    .select('id, name, investment_thesis, description, target_round, round_size_label, asset_class, geography, sponsor')
    .eq('id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .single();
  if (!project) notFound();

  const { data: partnersRaw } = await db
    .from('partners')
    .select('id, company_name, contact_name, weighted_score, category, status, source, network_distance, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .eq('project_id', params.id)
    .eq('organisation_id', profile.organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  const summary = computePoolSummary((partnersRaw || []) as PoolPartner[], { kind: 'project' });

  const subline = [
    project.target_round,
    project.round_size_label || project.asset_class,
    project.geography,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="max-w-5xl mx-auto">
      <div className="print:hidden">
        <Link href="/projects" className="flex items-center gap-2 text-dark-400 hover:text-white mb-6 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to projects
        </Link>
      </div>

      <PoolSummaryView
        kind="project"
        ownerName={project.name}
        subline={subline}
        summary={summary}
        partnersHref={`/partners?project=${project.id}`}
        icons={{ users: Users, sparkles: Sparkles, globe: Globe, languages: Languages, barChart: BarChart3 }}
      />
    </div>
  );
}
