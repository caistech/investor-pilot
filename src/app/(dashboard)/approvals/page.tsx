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

    items = (steps || []).map((s: any) => ({
      step_id: s.id,
      message_id: s.outbound_messages?.id || s.outbound_message_id,
      partner_id: s.partner_id,
      partner_name: s.partners?.company_name || 'Unknown',
      partner_score: s.partners?.weighted_score ?? null,
      channel: s.channel,
      scheduled_for: s.scheduled_for,
      rendered_subject: s.outbound_messages?.rendered_subject || null,
      rendered_body: s.outbound_messages?.rendered_body || '',
      compliance_check: s.outbound_messages?.compliance_check || null,
      personalization_score: s.outbound_messages?.personalization_score ?? null,
    }));
  }

  return <ApprovalsClient items={items} />;
}
