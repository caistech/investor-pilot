import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Mail, Link2, Globe } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/types';
import type { Partner, PartnerStatus, SessionEvent } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';
import { DraftEditor } from '@/components/partners/draft-editor';

function RadarChart({ partner }: { partner: Partner }) {
  const dimensions = [
    { label: 'Overlap', score: partner.audience_overlap_score || 0 },
    { label: 'Complement', score: partner.complementarity_score || 0 },
    { label: 'Readiness', score: partner.partner_readiness_score || 0 },
    { label: 'Reach', score: partner.reachability_score || 0 },
    { label: 'Leverage', score: partner.strategic_leverage_score || 0 },
  ];
  const cx = 100, cy = 100, r = 70;
  const angles = dimensions.map((_, i) => (Math.PI * 2 * i) / 5 - Math.PI / 2);

  const bgPoints = angles.map((a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`).join(' ');
  const dataPoints = dimensions.map((d, i) => {
    const scale = (d.score / 10) * r;
    return `${cx + scale * Math.cos(angles[i])},${cy + scale * Math.sin(angles[i])}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-xs mx-auto">
      {[0.2, 0.4, 0.6, 0.8, 1].map((s) => (
        <polygon
          key={s}
          points={angles.map((a) => `${cx + r * s * Math.cos(a)},${cy + r * s * Math.sin(a)}`).join(' ')}
          fill="none"
          stroke="rgb(51,65,85)"
          strokeWidth="0.5"
        />
      ))}
      {angles.map((a, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgb(51,65,85)" strokeWidth="0.5" />
      ))}
      <polygon points={bgPoints} fill="none" stroke="rgb(71,85,105)" strokeWidth="1" />
      <polygon points={dataPoints} fill="rgba(34,197,94,0.15)" stroke="rgb(34,197,94)" strokeWidth="2" />
      {dimensions.map((d, i) => (
        <text
          key={i}
          x={cx + (r + 18) * Math.cos(angles[i])}
          y={cy + (r + 18) * Math.sin(angles[i])}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-dark-400 text-[8px]"
        >
          {d.label} ({d.score})
        </text>
      ))}
    </svg>
  );
}

export default async function PartnerDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: partner } = await supabase
    .from('partners')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!partner) notFound();
  const p = partner as Partner;

  const { data: profile } = await supabase.from('profiles').select('organisation_id').single();
  const organisationId = profile?.organisation_id || '';

  const { data: events } = await supabase
    .from('session_events')
    .select('*')
    .eq('partner_id', params.id)
    .order('created_at', { ascending: true });

  return (
    <div>
      <Link href="/partners" className="flex items-center gap-2 text-dark-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Partners
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-start gap-4">
              {p.domain ? (
                <CompanyLogo domain={p.domain} companyName={p.company_name} size={48} className="rounded-lg" />
              ) : (
                <div className="w-12 h-12 bg-dark-700 rounded-lg flex items-center justify-center text-xl font-bold">
                  {p.company_name[0]}
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h2>{p.company_name}</h2>
                  <span className={STATUS_COLORS[p.status as PartnerStatus]}>{p.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-dark-400 text-sm">
                  {p.domain && (
                    <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white">
                      <Globe className="w-3 h-3" /> {p.domain}
                    </a>
                  )}
                  {p.category && <span>{p.category}</span>}
                  {p.partner_type && <span>{p.partner_type}</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold">{p.weighted_score?.toFixed(1) ?? '—'}</div>
                <div className="text-dark-500 text-sm">weighted score</div>
                {p.confidence_score === 'low-confidence' && <span className="badge-amber mt-1">low confidence</span>}
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="card">
            <h4 className="mb-4">Contact</h4>
            {p.contact_name ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{p.contact_name}</div>
                    <div className="text-dark-400 text-sm">{p.contact_title}</div>
                  </div>
                  {p.email_status && <span className={p.email_status === 'verified' ? 'badge-green' : 'badge-amber'}>{p.email_status}</span>}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {p.contact_email && (
                    <a href={`mailto:${p.contact_email}`} className="flex items-center gap-1 text-dark-400 hover:text-white">
                      <Mail className="w-3 h-3" /> {p.contact_email}
                    </a>
                  )}
                  {p.contact_linkedin && (
                    <a href={p.contact_linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-dark-400 hover:text-white">
                      <Link2 className="w-3 h-3" /> LinkedIn
                    </a>
                  )}
                </div>
                {p.email_confidence && <div className="text-dark-500 text-xs mt-1">Email confidence: {p.email_confidence}% | Source: {p.contact_source}</div>}
              </div>
            ) : (
              <p className="text-dark-500">No contact found yet.</p>
            )}
          </div>

          {/* Draft Editor */}
          <DraftEditor
            partnerId={p.id}
            organisationId={organisationId}
            contactEmail={p.contact_email}
            initialSubject={p.draft_subject}
            initialBody={p.draft_body}
            draftStatus={p.draft_status}
            partnerStatus={p.status}
          />

          {/* Notes */}
          <div className="card">
            <h4 className="mb-4">Scoring Notes</h4>
            <div className="space-y-3 text-sm">
              {[
                { label: 'Audience Overlap', notes: p.audience_overlap_notes, score: p.audience_overlap_score },
                { label: 'Complementarity', notes: p.complementarity_notes, score: p.complementarity_score },
                { label: 'Regulatory Standing', notes: p.partner_readiness_notes, score: p.partner_readiness_score },
                { label: 'Reachability', notes: p.reachability_notes, score: p.reachability_score },
                { label: 'Strategic Leverage', notes: p.strategic_leverage_notes, score: p.strategic_leverage_score },
              ].map((dim) => (
                <div key={dim.label} className="border-b border-dark-800 pb-3 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-dark-300">{dim.label}</span>
                    <span className="font-mono">{dim.score ?? '—'}/10</span>
                  </div>
                  <p className="text-dark-500">{dim.notes || 'No notes'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Trail */}
          {events && events.length > 0 && (
            <div className="card">
              <h4 className="mb-4">Evidence Trail</h4>
              <div className="space-y-2">
                {(events as SessionEvent[]).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3 text-sm border-b border-dark-800 pb-2 last:border-0">
                    <div className="text-dark-600 text-xs whitespace-nowrap mt-0.5">{formatDateTime(ev.created_at)}</div>
                    <div>
                      <span className="badge-blue text-xs mr-2">{ev.event_type}</span>
                      <span className="text-dark-400">{JSON.stringify(ev.event_data).slice(0, 200)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card">
            <h4 className="mb-4">Score Breakdown</h4>
            <RadarChart partner={p} />
          </div>

          {p.partnership_motion && (
            <div className="card">
              <h4 className="mb-2">Engagement Strategy</h4>
              <p className="text-dark-400 text-sm">{p.partnership_motion}</p>
            </div>
          )}

          {p.selected_gtm_angle && (
            <div className="card">
              <h4 className="mb-2">GTM Angle</h4>
              <p className="text-dark-400 text-sm">{p.selected_gtm_angle}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
