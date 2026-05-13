import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Mail, Link2, Globe } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/types';
import type { Partner, PartnerStatus, SessionEvent } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';
import { DraftEditor } from '@/components/partners/draft-editor';
import AssignSequence from '@/components/partners/assign-sequence';
import PartnerCommunications, {
  type PendingApproval,
  type TimelineEvent,
} from '@/components/partners/partner-communications';

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

  // Pull active templates + any live (non-terminal) sequence_steps so we can
  // either show "Assign to sequence" or the current in-flight status.
  const [{ data: templates }, { data: liveStepsRaw }] = await Promise.all([
    supabase
      .from('sequence_templates')
      .select('id, name, vertical, compliance_mode')
      .eq('organisation_id', organisationId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('sequence_steps')
      .select(`
        id, template_id, step_index, status, scheduled_for,
        sequence_templates ( name )
      `)
      .eq('organisation_id', organisationId)
      .eq('partner_id', params.id)
      .not('status', 'in', '(sent,skipped,failed,replied,opted_out,compliance_blocked)'),
  ]);

  const liveSteps = (liveStepsRaw || []).map((s: Record<string, unknown>) => {
    const tpl = Array.isArray(s.sequence_templates) ? s.sequence_templates[0] : s.sequence_templates;
    return {
      id: s.id as string,
      template_id: s.template_id as string,
      template_name: ((tpl as { name?: string } | null)?.name) || 'Unknown template',
      step_index: s.step_index as number,
      status: s.status as string,
      scheduled_for: s.scheduled_for as string,
    };
  });

  // Auto-pick template based on partner's network_distance. 1st-degree → warm
  // DM template (no connect step, faster cadence). Anyone else → cold sequence.
  // Operator can still switch manually in the dropdown if they want.
  const networkDistance = p.network_distance;
  const warmTemplate = (templates || []).find(t => /warm/i.test(t.name));
  const coldTemplate = (templates || []).find(t => !/warm/i.test(t.name));
  const recommendedTemplateId = networkDistance === '1st' && warmTemplate
    ? warmTemplate.id
    : (coldTemplate?.id || templates?.[0]?.id || null);

  // Communications thread — three sources merged into one timeline:
  //   1. Pending approvals  (sequence_steps + outbound_messages)
  //   2. Sent/failed history (outbound_messages with sent_at OR send_error)
  //   3. Inbound replies     (inbound_messages from webhook)
  //   4. Legacy email log    (outreach_log — pre-sequencer email sends)
  const [
    { data: pendingStepsRaw },
    { data: outboundRaw },
    { data: inboundRaw },
    { data: legacyEmailRaw },
  ] = await Promise.all([
    supabase
      .from('sequence_steps')
      .select(`
        id, channel, scheduled_for, outbound_message_id,
        outbound_messages ( id, rendered_subject, rendered_body, compliance_check, personalization_score )
      `)
      .eq('organisation_id', organisationId)
      .eq('partner_id', params.id)
      .eq('status', 'queued_for_approval')
      .order('scheduled_for', { ascending: true }),
    supabase
      .from('outbound_messages')
      .select('id, channel, rendered_subject, rendered_body, sent_at, approved_at, send_error, channel_message_id, created_at')
      .eq('organisation_id', organisationId)
      .eq('partner_id', params.id)
      .or('sent_at.not.is.null,send_error.not.is.null')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('inbound_messages')
      .select('id, channel, body, received_at, classification')
      .eq('organisation_id', organisationId)
      .eq('partner_id', params.id)
      .order('received_at', { ascending: false })
      .limit(50),
    supabase
      .from('outreach_log')
      .select('id, subject, body, sent_at, status, gmail_message_id, created_at')
      .eq('organisation_id', organisationId)
      .eq('partner_id', params.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const pendingApprovals: PendingApproval[] = (pendingStepsRaw || []).map((s: any) => {
    const msg = Array.isArray(s.outbound_messages) ? s.outbound_messages[0] : s.outbound_messages;
    return {
      step_id: s.id,
      message_id: msg?.id || s.outbound_message_id,
      channel: s.channel,
      scheduled_for: s.scheduled_for,
      rendered_subject: msg?.rendered_subject || null,
      rendered_body: msg?.rendered_body || '',
      compliance_check: msg?.compliance_check || null,
      personalization_score: msg?.personalization_score ?? null,
    };
  });

  const timeline: TimelineEvent[] = [
    ...((outboundRaw || []) as Array<Record<string, unknown>>).map(o => ({
      id: o.id as string,
      kind: 'outbound' as const,
      channel: o.channel as string,
      timestamp: (o.sent_at as string) || (o.created_at as string),
      subject: (o.rendered_subject as string) || null,
      body: (o.rendered_body as string) || '',
      meta: {
        send_error: (o.send_error as string) || null,
        channel_message_id: (o.channel_message_id as string) || null,
        status: o.sent_at ? 'sent' : o.send_error ? 'failed' : 'queued',
      },
    })),
    ...((inboundRaw || []) as Array<Record<string, unknown>>).map(i => ({
      id: i.id as string,
      kind: 'inbound' as const,
      channel: i.channel as string,
      timestamp: i.received_at as string,
      subject: null,
      body: (i.body as string) || '(empty body)',
      meta: {
        classification: (i.classification as { intent?: string; requires_human?: boolean }) || null,
      },
    })),
    ...((legacyEmailRaw || []) as Array<Record<string, unknown>>).map(l => ({
      id: l.id as string,
      kind: 'legacy_email' as const,
      channel: 'email',
      timestamp: (l.sent_at as string) || (l.created_at as string),
      subject: (l.subject as string) || null,
      body: (l.body as string) || '',
      meta: {
        status: l.status as string,
        channel_message_id: (l.gmail_message_id as string) || null,
      },
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

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

          {/* Unified comms — pending approvals + sent + inbound. Per-contact
              lens; /approvals remains the compilation view across all partners. */}
          <PartnerCommunications pendingApprovals={pendingApprovals} timeline={timeline} />

          {/* Draft Editor — manual email composition path (legacy v2). Still
              useful for one-off direct sends outside the sequencer. */}
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

          <AssignSequence
            partnerId={p.id}
            templates={templates || []}
            liveSteps={liveSteps}
            recommendedTemplateId={recommendedTemplateId}
            networkDistance={networkDistance || null}
          />


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
