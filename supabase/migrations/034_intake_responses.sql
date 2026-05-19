-- Migration 034 — intake_responses
--
-- Stores responses captured by the Connexions intake flow (the prospect-
-- facing AI interview operators link to as the outreach CTA). Today the
-- responses live in Connexions; this table receives them via the
-- /api/webhooks/connexions-intake webhook so they attach to the partner
-- record that triggered the click.
--
-- Schema is generic over the intake source (the `source` column lets us
-- add native InvestorPilot intakes or other partner products later
-- without another migration).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + IF NOT EXISTS on indexes/policies.

CREATE TABLE IF NOT EXISTS intake_responses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- nullable: organic intakes (no ?ref in landing URL) and intakes where
  -- the ref points to a partner that's since been deleted both end up
  -- unattributed but should still be visible (admin "unattributable
  -- intakes" view).
  partner_id           UUID REFERENCES partners(id) ON DELETE SET NULL,
  -- The source system's stable UUID. UNIQUE so duplicate webhook deliveries
  -- (Connexions retries) result in idempotent upserts rather than dupes.
  external_intake_id   TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'connexions',
  intake_slug          TEXT,        -- e.g. 'platform-trust-sprint-intake'
  src_param            TEXT,        -- 'ip-outreach' | 'organic' | ...
  completed_at         TIMESTAMPTZ,
  prospect_name        TEXT,
  prospect_email       TEXT,
  prospect_company     TEXT,
  prospect_linkedin    TEXT,
  answers              JSONB,
  summary              TEXT,
  duration_seconds     INTEGER,
  -- Full webhook body preserved for audit / replay / schema-debugging.
  raw_payload          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup index — webhook handler relies on the unique violation to detect
-- "already processed this intake" without a separate SELECT round-trip.
CREATE UNIQUE INDEX IF NOT EXISTS intake_responses_external_idx
  ON intake_responses(external_intake_id);

-- Partial index on partner_id — the partner-card surface joins through
-- this and we don't want to scan unattributed rows during that lookup.
CREATE INDEX IF NOT EXISTS intake_responses_partner_idx
  ON intake_responses(partner_id) WHERE partner_id IS NOT NULL;

-- Org-scoped listing index for "all completed intakes this month" admin
-- views. Ordered DESC because operators view newest-first.
CREATE INDEX IF NOT EXISTS intake_responses_org_completed_idx
  ON intake_responses(organisation_id, completed_at DESC);

ALTER TABLE intake_responses ENABLE ROW LEVEL SECURITY;

-- Read policy: operators see intakes for their active org OR (fallback)
-- their legacy single-org column. Multi-org users see only the org they
-- have currently active per profiles.active_organisation_id.
--
-- See [[jwt-claim-multi-org-pattern]] in operator memory for the broader
-- pattern; this just mirrors the same UNION + COALESCE-style read scope
-- the other tables use post-029.
DROP POLICY IF EXISTS intake_responses_read_own_org ON intake_responses;
CREATE POLICY intake_responses_read_own_org ON intake_responses FOR SELECT
  USING (
    organisation_id IN (
      SELECT active_organisation_id FROM profiles WHERE id = auth.uid()
      UNION
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- No INSERT / UPDATE / DELETE policies — only the service-role client
-- (inside the webhook handler) writes rows. Operators can't manually
-- create or mutate intake responses; they're sourced from external
-- systems via signed webhooks. If we ever need an operator-facing edit
-- path (e.g. to redact a response), add a service-role-only API route,
-- not a client-side RLS policy.
