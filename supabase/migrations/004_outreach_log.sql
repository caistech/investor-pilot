-- Outreach log: tracks every email sent, its status, and follow-up schedule
CREATE TABLE IF NOT EXISTS outreach_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL CHECK (email_type IN ('first_touch', 'follow_up_1', 'follow_up_2', 'follow_up_3')),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'replied', 'bounced', 'failed')),
  reply_received_at TIMESTAMPTZ,
  follow_up_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_log_org ON outreach_log(organisation_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_partner ON outreach_log(partner_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_status ON outreach_log(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_log_follow_up ON outreach_log(follow_up_due_at) WHERE status = 'sent';

-- RLS
ALTER TABLE outreach_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view outreach_log" ON outreach_log FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can manage outreach_log" ON outreach_log FOR ALL
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

-- Service role full access (API routes use service client)
CREATE POLICY "Service role full access on outreach_log"
  ON outreach_log FOR ALL
  USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_outreach_log_updated_at
  BEFORE UPDATE ON outreach_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
