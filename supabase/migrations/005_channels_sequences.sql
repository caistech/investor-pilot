-- Migration 005 — Multi-channel outreach: client_channels, sequence_templates,
-- sequence_steps, outbound_messages, audit_events, inbound_messages, draft_replies.
-- Audience-agnostic. Supports lender-channel outreach (v3) and any future audience.
--
-- Per CLAUDE.md REVENUE-tier discipline:
--   - All tables have RLS enabled
--   - Idempotent (wrapped in IF NOT EXISTS / DO blocks)
--   - tenant_id columns from day 1 (organisation_id), even though enforcement is
--     single-tenant in Sprint 1; multi-tenant gating activates at customer #2.

-- =============================================================================
-- client_channels: one row per (organisation_id, channel_type, account)
-- Tracks LinkedIn / Gmail / Outlook / Microsoft accounts the operator has
-- connected via Unipile OAuth.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('linkedin', 'email', 'calendar')),
  provider text NOT NULL CHECK (provider IN ('unipile', 'google', 'microsoft', 'resend')),
  account_identifier text NOT NULL, -- email address or LinkedIn URN
  display_name text,
  oauth_token_ref text, -- pointer to Unipile's account id, NEVER the token itself
  daily_send_cap int NOT NULL DEFAULT 20,
  daily_send_count int NOT NULL DEFAULT 0,
  cap_reset_at timestamptz, -- when daily_send_count rolls over (next 00:00 sender-local)
  warmup_day int NOT NULL DEFAULT 1, -- day 1-21 of warmup curve; 22+ = full cap
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'flagged', 'revoked')),
  pause_reason text,
  last_health_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, channel_type, account_identifier)
);

CREATE INDEX IF NOT EXISTS idx_client_channels_org ON public.client_channels(organisation_id);
CREATE INDEX IF NOT EXISTS idx_client_channels_status ON public.client_channels(status) WHERE status != 'active';

ALTER TABLE public.client_channels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY client_channels_org_isolation ON public.client_channels
    FOR ALL TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ))
    WITH CHECK (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- sequence_templates: ordered sets of outreach steps per vertical/campaign
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sequence_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  vertical text, -- e.g. 'senior_debt_au_property', 'family_office_au', 'wholesale_property_au'
  description text,
  steps jsonb NOT NULL, -- ordered array of {channel, delay_days, template_key, branch_logic}
  compliance_mode text NOT NULL DEFAULT 'standard' CHECK (compliance_mode IN ('standard', 'finance_au_wholesale', 'finance_au_senior_debt', 'finance_us')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequence_templates_org ON public.sequence_templates(organisation_id);

ALTER TABLE public.sequence_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY sequence_templates_org_isolation ON public.sequence_templates
    FOR ALL TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ))
    WITH CHECK (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- sequence_steps: per-prospect, per-step state machine
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.sequence_templates(id) ON DELETE RESTRICT,
  step_index int NOT NULL,
  channel text NOT NULL CHECK (channel IN ('linkedin_connect', 'linkedin_dm', 'email', 'manual')),
  scheduled_for timestamptz NOT NULL,
  executed_at timestamptz,
  outbound_message_id uuid, -- FK to outbound_messages, set after send
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_verification', 'queued_for_approval', 'sent', 'skipped', 'failed', 'replied', 'opted_out', 'compliance_blocked')),
  branch_taken text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequence_steps_partner ON public.sequence_steps(partner_id);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_scheduled ON public.sequence_steps(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sequence_steps_approval ON public.sequence_steps(status) WHERE status = 'queued_for_approval';

ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY sequence_steps_org_isolation ON public.sequence_steps
    FOR ALL TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ))
    WITH CHECK (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- outbound_messages: every message we send (separate from outreach_log which is
-- email-only legacy from v2)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  sequence_step_id uuid REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  client_channel_id uuid NOT NULL REFERENCES public.client_channels(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('linkedin_connect', 'linkedin_dm', 'email')),
  channel_message_id text, -- platform's ID (Unipile message id, Resend message id, etc)
  rendered_subject text,
  rendered_body text NOT NULL,
  evidence_refs jsonb, -- which discovery/scoring evidence grounded this draft
  compliance_check jsonb, -- {pass: bool, flags: [], rules_triggered: []}
  personalization_score int, -- 0-10 from approval-queue scoring rubric
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  send_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_partner ON public.outbound_messages(partner_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_org ON public.outbound_messages(organisation_id);

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY outbound_messages_org_isolation ON public.outbound_messages
    FOR ALL TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ))
    WITH CHECK (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- inbound_messages: replies received via webhook (LinkedIn DM, email reply)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  client_channel_id uuid REFERENCES public.client_channels(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('linkedin_dm', 'email', 'linkedin_connect_accept')),
  channel_message_id text UNIQUE, -- prevents duplicate webhook processing
  received_at timestamptz NOT NULL DEFAULT now(),
  body text,
  classification jsonb, -- {intent, sentiment, requires_human, suggested_branch, key_topics[]}
  draft_reply_id uuid, -- FK to draft_replies (Phase 3 deferred)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_partner ON public.inbound_messages(partner_id);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_received ON public.inbound_messages(received_at DESC);

ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY inbound_messages_org_isolation ON public.inbound_messages
    FOR ALL TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ))
    WITH CHECK (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- audit_events: Platform Trust audit log (compliance backbone + debug surface)
-- Every channel send, approval, classification writes here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  actor text NOT NULL, -- 'user:<uuid>' | 'system:sequencer' | 'system:compliance' | etc
  action text NOT NULL, -- 'channel.send' | 'approval.granted' | 'compliance.block' | etc
  resource_type text, -- 'outbound_message' | 'sequence_step' | 'client_channel' | etc
  resource_id uuid,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org ON public.audit_events(organisation_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON public.audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON public.audit_events(created_at DESC);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- audit_events is read-only for org members (only service-role inserts)
DO $$ BEGIN
  CREATE POLICY audit_events_org_read ON public.audit_events
    FOR SELECT TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Auto-update updated_at trigger (reuses existing function from migration 001 if present)
-- =============================================================================

DO $$ BEGIN
  CREATE TRIGGER set_client_channels_updated_at
    BEFORE UPDATE ON public.client_channels
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_sequence_templates_updated_at
    BEFORE UPDATE ON public.sequence_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_sequence_steps_updated_at
    BEFORE UPDATE ON public.sequence_steps
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;
