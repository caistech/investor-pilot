import { createClient } from '@/lib/supabase/server';
import ApprovalsClient from './approvals-client';

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
        partner_id,
        outbound_message_id,
        partners ( id, company_name, weighted_score ),
        outbound_messages ( id, rendered_subject, rendered_body, compliance_check, personalization_score )
      `)
      .eq('organisation_id', profile.organisation_id)
      .eq('status', 'queued_for_approval')
      .order('scheduled_for', { ascending: true })
      .limit(50);

    items = (steps || []).map((s: any) => {
      // Supabase returns FK-joined rows as arrays even for 1:1 relationships.
      // Normalise both partners and outbound_messages to a single object.
      const partner = Array.isArray(s.partners) ? s.partners[0] : s.partners;
      const message = Array.isArray(s.outbound_messages) ? s.outbound_messages[0] : s.outbound_messages;
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
      };
    });
  }

  return <ApprovalsClient items={items} />;
}
