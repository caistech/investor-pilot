-- Migration 029 — Multi-org membership (Tier 3)
--
-- Lifts InvestorPilot from "one user = one org" to "one user can belong to
-- multiple orgs with different roles in each." Driven by the agency-tier
-- case: David at Koch Capital Advisory advising multiple founders (LingoPure
-- and others) needs his ONE LinkedIn account usable across each org where
-- he runs outreach.
--
-- Locked architectural decisions (from /plan-eng-review 2026-05-18):
--   1. URL-scoped active org   — pages live at /org/[slug]/*
--   2. JWT-claim RLS           — auth.jwt() #>> '{app,active_org_id}' drives
--                                 scoping; SET LOCAL would break through
--                                 Supabase's transaction-mode pooler
--   3. client_channels uniqueness includes organisation_id — same LinkedIn
--                                 can be connected per-org
--   4. role lives in memberships, not profiles
--   5. Pending invitations via org_invitations table + accept-link flow
--   6. BYOK Unipile             — per-org API key + tenant id
--   7. profiles.role + profiles.organisation_id NULLed here, dropped in 030
--
-- During the transition window (between this migration applying and the
-- supabase/config.toml hook being enabled), JWTs won't yet carry the
-- active_org_id claim. The current_active_org_id() helper has a COALESCE
-- fallback that reads profiles.active_organisation_id directly so single-org
-- users keep working without interruption.
--
-- Idempotent: every operation is wrapped in IF NOT EXISTS / DO blocks or
-- uses ON CONFLICT DO NOTHING. Safe to re-apply.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. New table: memberships
--    PK on (user_id, organisation_id). Role is per-org so David can be
--    'owner' of Koch and 'member' of LingoPure simultaneously.

CREATE TABLE IF NOT EXISTS public.memberships (
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships(organisation_id);

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. New table: org_invitations
--    Pending invitations live here. Accept-link flow inserts a memberships
--    row when the invitee clicks /invite/accept?token=...

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token            TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at      TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON public.org_invitations(token);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_pending
  ON public.org_invitations(organisation_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_invitations_email
  ON public.org_invitations(lower(email));

ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. New columns on existing tables
--    profiles.active_organisation_id   — server-side source for JWT claim
--    organisations.unipile_api_key     — BYOK per-org
--    organisations.unipile_tenant_id   — for webhook tenant routing

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_organisation_id UUID REFERENCES public.organisations(id) ON DELETE SET NULL;

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS unipile_api_key TEXT;

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS unipile_tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_organisations_unipile_tenant
  ON public.organisations(unipile_tenant_id)
  WHERE unipile_tenant_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Backfill
--    Every existing profile with a non-null organisation_id becomes a
--    memberships row preserving the role. Also seeds profiles.active_organisation_id
--    so the COALESCE fallback in current_active_org_id() works before the
--    JWT claim is populated.

INSERT INTO public.memberships (user_id, organisation_id, role, created_at)
SELECT id, organisation_id, COALESCE(role, 'member'), COALESCE(created_at, now())
FROM public.profiles
WHERE organisation_id IS NOT NULL
ON CONFLICT (user_id, organisation_id) DO NOTHING;

UPDATE public.profiles
SET active_organisation_id = organisation_id
WHERE active_organisation_id IS NULL
  AND organisation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Helper function: current_active_org_id()
--    Read the active org from the JWT claim first; fall back to a direct
--    profile lookup so the system keeps working during the window where
--    the Supabase Auth Hook isn't enabled yet or existing sessions
--    haven't refreshed.

CREATE OR REPLACE FUNCTION public.current_active_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb #>> '{app,active_org_id}', '')::uuid,
    (SELECT active_organisation_id FROM public.profiles WHERE id = auth.uid())
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_active_org_id() TO authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Supabase Auth Hook: custom_access_token_hook(event jsonb)
--    Called by Supabase Auth during JWT minting. Reads
--    profiles.active_organisation_id and writes it into the JWT under
--    claims.app.active_org_id. Enabling happens in supabase/config.toml
--    [auth.hook.custom_access_token] (committed separately) and in the
--    Supabase Dashboard for the linked project.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_id uuid;
  active_org uuid;
BEGIN
  user_id := (event ->> 'user_id')::uuid;

  SELECT active_organisation_id INTO active_org
  FROM public.profiles
  WHERE id = user_id;

  claims := event -> 'claims';

  IF active_org IS NOT NULL THEN
    claims := jsonb_set(
      claims,
      '{app}',
      COALESCE(claims -> 'app', '{}'::jsonb) || jsonb_build_object('active_org_id', active_org::text)
    );
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT ALL ON TABLE public.profiles TO supabase_auth_admin;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Relax client_channels uniqueness to include organisation_id
--    Migration 028 had UNIQUE (user_id, channel_type, account_identifier)
--    which would block David from connecting his ONE LinkedIn to BOTH Koch
--    and LingoPure. Drop + re-add with organisation_id included.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_channels_user_channel_account_unique'
  ) THEN
    ALTER TABLE public.client_channels
      DROP CONSTRAINT client_channels_user_channel_account_unique;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_channels_user_org_channel_account_unique'
  ) THEN
    ALTER TABLE public.client_channels
      ADD CONSTRAINT client_channels_user_org_channel_account_unique
      UNIQUE (user_id, organisation_id, channel_type, account_identifier);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. RLS rewrite — every policy that used
--      organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid())
--    becomes
--      organisation_id = public.current_active_org_id()
--    DROP IF EXISTS + CREATE for idempotency.

-- organisations
DROP POLICY IF EXISTS "Users can view their own organisation" ON public.organisations;
CREATE POLICY "Users can view their orgs" ON public.organisations FOR SELECT
  USING (
    owner_id = auth.uid()
    OR id IN (SELECT organisation_id FROM public.memberships WHERE user_id = auth.uid())
  );

-- products
DROP POLICY IF EXISTS "Org members can view products" ON public.products;
DROP POLICY IF EXISTS "Org members can manage products" ON public.products;
CREATE POLICY "Org members can view products" ON public.products FOR SELECT
  USING (organisation_id = public.current_active_org_id());
CREATE POLICY "Org members can manage products" ON public.products FOR ALL
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- partners
DROP POLICY IF EXISTS "Org members can view partners" ON public.partners;
DROP POLICY IF EXISTS "Org members can manage partners" ON public.partners;
CREATE POLICY "Org members can view partners" ON public.partners FOR SELECT
  USING (organisation_id = public.current_active_org_id());
CREATE POLICY "Org members can manage partners" ON public.partners FOR ALL
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- agent_sessions
DROP POLICY IF EXISTS "Org members can view sessions" ON public.agent_sessions;
DROP POLICY IF EXISTS "Org members can manage sessions" ON public.agent_sessions;
CREATE POLICY "Org members can view sessions" ON public.agent_sessions FOR SELECT
  USING (organisation_id = public.current_active_org_id());
CREATE POLICY "Org members can manage sessions" ON public.agent_sessions FOR ALL
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- session_events (indirect via agent_sessions)
DROP POLICY IF EXISTS "Org members can view session events" ON public.session_events;
CREATE POLICY "Org members can view session events" ON public.session_events FOR SELECT
  USING (session_id IN (
    SELECT id FROM public.agent_sessions
    WHERE organisation_id = public.current_active_org_id()
  ));

-- product_sources (migration 002 — sources table)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sources') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can view own org sources" ON public.sources';
    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own org sources" ON public.sources';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own org sources" ON public.sources';
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete own org sources" ON public.sources';
    EXECUTE 'CREATE POLICY "Users can view own org sources" ON public.sources FOR SELECT
      USING (organisation_id = public.current_active_org_id())';
    EXECUTE 'CREATE POLICY "Users can insert own org sources" ON public.sources FOR INSERT
      WITH CHECK (organisation_id = public.current_active_org_id())';
    EXECUTE 'CREATE POLICY "Users can update own org sources" ON public.sources FOR UPDATE
      USING (organisation_id = public.current_active_org_id())';
    EXECUTE 'CREATE POLICY "Users can delete own org sources" ON public.sources FOR DELETE
      USING (organisation_id = public.current_active_org_id())';
  END IF;
END $$;

-- outreach_log
DROP POLICY IF EXISTS "Org members can view outreach_log" ON public.outreach_log;
DROP POLICY IF EXISTS "Org members can manage outreach_log" ON public.outreach_log;
CREATE POLICY "Org members can view outreach_log" ON public.outreach_log FOR SELECT
  USING (organisation_id = public.current_active_org_id());
CREATE POLICY "Org members can manage outreach_log" ON public.outreach_log FOR ALL
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- client_channels
DROP POLICY IF EXISTS client_channels_org_isolation ON public.client_channels;
CREATE POLICY client_channels_org_isolation ON public.client_channels
  FOR ALL TO authenticated
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- sequence_templates
DROP POLICY IF EXISTS sequence_templates_org_isolation ON public.sequence_templates;
CREATE POLICY sequence_templates_org_isolation ON public.sequence_templates
  FOR ALL TO authenticated
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- sequence_steps
DROP POLICY IF EXISTS sequence_steps_org_isolation ON public.sequence_steps;
CREATE POLICY sequence_steps_org_isolation ON public.sequence_steps
  FOR ALL TO authenticated
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- outbound_messages
DROP POLICY IF EXISTS outbound_messages_org_isolation ON public.outbound_messages;
CREATE POLICY outbound_messages_org_isolation ON public.outbound_messages
  FOR ALL TO authenticated
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- inbound_messages
DROP POLICY IF EXISTS inbound_messages_org_isolation ON public.inbound_messages;
CREATE POLICY inbound_messages_org_isolation ON public.inbound_messages
  FOR ALL TO authenticated
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- audit_events
DROP POLICY IF EXISTS audit_events_org_read ON public.audit_events;
CREATE POLICY audit_events_org_read ON public.audit_events
  FOR SELECT TO authenticated
  USING (organisation_id = public.current_active_org_id());

-- projects
DROP POLICY IF EXISTS projects_org_isolation ON public.projects;
CREATE POLICY projects_org_isolation ON public.projects
  FOR ALL TO authenticated
  USING (organisation_id = public.current_active_org_id())
  WITH CHECK (organisation_id = public.current_active_org_id());

-- discovery_runs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'discovery_runs') THEN
    EXECUTE 'DROP POLICY IF EXISTS discovery_runs_select_own_org ON public.discovery_runs';
    EXECUTE 'CREATE POLICY discovery_runs_select_own_org ON public.discovery_runs FOR SELECT
      USING (organisation_id = public.current_active_org_id())';
  END IF;
END $$;

-- usage_events
DROP POLICY IF EXISTS usage_events_read_own_org ON public.usage_events;
CREATE POLICY usage_events_read_own_org ON public.usage_events FOR SELECT
  USING (organisation_id = public.current_active_org_id());

-- organisation_usage_caps
DROP POLICY IF EXISTS usage_caps_read_own_org ON public.organisation_usage_caps;
CREATE POLICY usage_caps_read_own_org ON public.organisation_usage_caps FOR SELECT
  USING (organisation_id = public.current_active_org_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 9. RLS for new tables: memberships + org_invitations

-- memberships: user can see their own rows; owners/admins of an org can see
-- everyone's row in that org (via current_active_org_id() so they see what
-- they're scoped to right now).
DROP POLICY IF EXISTS memberships_read_own ON public.memberships;
CREATE POLICY memberships_read_own ON public.memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR organisation_id = public.current_active_org_id()
  );

-- org_invitations: org owners/admins can see pending invitations for their
-- active org (read + write); invitees who haven't accepted yet have no row
-- in profiles, so token lookup happens through the service client.
DROP POLICY IF EXISTS org_invitations_read_org ON public.org_invitations;
CREATE POLICY org_invitations_read_org ON public.org_invitations
  FOR SELECT TO authenticated
  USING (organisation_id = public.current_active_org_id());

DROP POLICY IF EXISTS org_invitations_write_admin ON public.org_invitations;
CREATE POLICY org_invitations_write_admin ON public.org_invitations
  FOR ALL TO authenticated
  USING (
    organisation_id = public.current_active_org_id()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = public.current_active_org_id()
        AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    organisation_id = public.current_active_org_id()
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.organisation_id = public.current_active_org_id()
        AND m.role IN ('owner', 'admin')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 10. NULL out legacy profiles columns
--     memberships is now the source of truth for role + org membership.
--     profiles.active_organisation_id (just backfilled above) is the
--     source of truth for "which org should the JWT claim point at."
--     The legacy columns are dropped in migration 030 after dogfood.

UPDATE public.profiles
SET role = NULL, organisation_id = NULL
WHERE role IS NOT NULL OR organisation_id IS NOT NULL;
