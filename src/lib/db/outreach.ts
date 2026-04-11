import type { SupabaseClient } from '@supabase/supabase-js';

export interface OutreachLogEntry {
  organisation_id: string;
  partner_id: string;
  email_type: 'first_touch' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3';
  to_email: string;
  subject: string;
  body: string;
  gmail_message_id?: string;
  gmail_thread_id?: string;
  sent_at?: string;
  status?: string;
  follow_up_due_at?: string;
}

export async function createOutreachEntry(
  db: SupabaseClient,
  entry: OutreachLogEntry
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await db
    .from('outreach_log')
    .insert({
      ...entry,
      status: entry.status || 'queued',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return { error: error.message };
  return { id: data?.id };
}

export async function markOutreachSent(
  db: SupabaseClient,
  outreachId: string,
  gmailData: { message_id?: string; thread_id?: string }
): Promise<{ error?: string }> {
  const sentAt = new Date().toISOString();
  const followUpDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await db
    .from('outreach_log')
    .update({
      status: 'sent',
      sent_at: sentAt,
      gmail_message_id: gmailData.message_id || null,
      gmail_thread_id: gmailData.thread_id || null,
      follow_up_due_at: followUpDue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', outreachId);

  return { error: error?.message };
}

export async function markOutreachReplied(
  db: SupabaseClient,
  outreachId: string,
  partnerId: string
): Promise<{ error?: string }> {
  const now = new Date().toISOString();

  // Update outreach_log
  const { error: logErr } = await db
    .from('outreach_log')
    .update({
      status: 'replied',
      reply_received_at: now,
      follow_up_due_at: null,
      updated_at: now,
    })
    .eq('id', outreachId);

  if (logErr) return { error: logErr.message };

  // Sync: update partner status to replied
  const { error: partnerErr } = await db
    .from('partners')
    .update({ status: 'replied', last_updated_at: now })
    .eq('id', partnerId);

  return { error: partnerErr?.message };
}

export async function getOverdueFollowUps(
  db: SupabaseClient,
  organisationId: string
): Promise<Array<{ id: string; partner_id: string; to_email: string; subject: string; email_type: string }>> {
  const { data } = await db
    .from('outreach_log')
    .select('id, partner_id, to_email, subject, email_type')
    .eq('organisation_id', organisationId)
    .eq('status', 'sent')
    .lte('follow_up_due_at', new Date().toISOString())
    .order('follow_up_due_at', { ascending: true });

  return data || [];
}
