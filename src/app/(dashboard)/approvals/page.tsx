import { createClient } from '@/lib/supabase/server';
import ApprovalsClient from './approvals-client';
import { SetupGate } from '@/components/layout/setup-gate';

export const dynamic = 'force-dynamic';

export interface ApprovalItem {
  step_id: string;
  message_id: string;
  partner_id: string | null;
  partner_name: string;
  partner_score: number | null;
  channel: string;
  scheduled_for: string;
  rendered_subject: string | null;
  rendered_body: string;
  compliance_check: { pass: boolean; blocked: boolean; flags: Array<{ level: string; reason: string; match: string }> } | null;
  personalization_score: number | null;
  /** Set when the renderer translated the body to a non-English target. */
  target_language: string | null;
  original_subject: string | null;
  original_body: string | null;
  /**
   * Score-derived tone tier the renderer picked. Approvals UI surfaces
   * this as a badge so the operator can spot exploratory-tier drafts
   * (hedged copy) before approving them. See computeOutreachTier in
   * src/lib/sequencer/render.ts.
   */
  outreach_tier: 'confident' | 'qualified' | 'exploratory' | null;
  /**
   * sequence_steps.status as fetched — distinguishes 'queued_for_approval'
   * (normal) from 'compliance_blocked' (regex flagged it, needs operator
   * Edit/Skip before it can ship). Drives the prominent "BLOCKED" badge
   * on the card.
   */
  step_status: 'queued_for_approval' | 'compliance_blocked';
}

export default async function ApprovalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organisation_id')
    .single();

  let items: ApprovalItem[] = [];

  if (profile?.organisation_id) {
    const { data: steps } = await supabase
      .from('sequence_steps')
      .select(`
        id,
        channel,
        scheduled_for,
        status,
        partner_id,
        outbound_message_id,
        partners ( id, company_name, weighted_score ),
        outbound_messages ( id, rendered_subject, rendered_body, compliance_check, personalization_score, evidence_refs )
      `)
      .eq('organisation_id', profile.organisation_id)
      // Show BOTH queued + compliance_blocked. Previously compliance_blocked
      // drafts were invisible from /approvals — the operator had to drill
      // into each prospect's detail page to see why a draft didn't ship.
      // Now they appear inline with the compliance flag rendered on the
      // card, so the fix path is one click (Edit / Skip / Regenerate)
      // instead of three. Operator flagged 2026-05-17.
      .in('status', ['queued_for_approval', 'compliance_blocked'])
      .order('scheduled_for', { ascending: true })
      .limit(50);

    items = (steps || []).map((s: any) => {
      // Supabase returns FK-joined rows as arrays even for 1:1 relationships.
      // Normalise both partners and outbound_messages to a single object.
      const partner = Array.isArray(s.partners) ? s.partners[0] : s.partners;
      const message = Array.isArray(s.outbound_messages) ? s.outbound_messages[0] : s.outbound_messages;
      const evidenceRefs = (message?.evidence_refs ?? {}) as Record<string, unknown>;
      return {
        step_id: s.id,
        message_id: message?.id || s.outbound_message_id,
        partner_id: s.partner_id,
        partner_name: partner?.company_name || 'Unknown',
        partner_score: partner?.weighted_score ?? null,
        channel: s.channel,
        scheduled_for: s.scheduled_for,
        rendered_subject: message?.rendered_subject || null,
        rendered_body: message?.rendered_body || '',
        compliance_check: message?.compliance_check || null,
        personalization_score: message?.personalization_score ?? null,
        target_language: typeof evidenceRefs.target_language === 'string' ? evidenceRefs.target_language : null,
        original_subject: typeof evidenceRefs.original_subject === 'string' ? evidenceRefs.original_subject : null,
        original_body: typeof evidenceRefs.original_body === 'string' && evidenceRefs.original_body.length > 0
          ? evidenceRefs.original_body
          : null,
        outreach_tier: evidenceRefs.outreach_tier === 'confident' || evidenceRefs.outreach_tier === 'qualified' || evidenceRefs.outreach_tier === 'exploratory'
          ? evidenceRefs.outreach_tier
          : null,
        step_status: s.status === 'compliance_blocked' ? 'compliance_blocked' : 'queued_for_approval',
      };
    });
  }

  return (
    <SetupGate
      required={['sequenceConfigured']}
      pageName="Approvals"
      pageVerb="review queued drafts"
    >
      <ApprovalsClient items={items} />
    </SetupGate>
  );
}
