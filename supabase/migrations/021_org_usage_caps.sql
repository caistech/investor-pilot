-- Migration 021 — org-level usage metering + caps
--
-- Adds per-organisation visibility and enforcement on the four external
-- services that drive variable cost:
--   * Brave Search   (per query)
--   * Hunter.io      (per email lookup)
--   * Unipile        (per connected account, billed monthly)
--   * LLM tokens     (per call, summed monthly)
--
-- Without caps, one tenant running discovery in a loop can rack up
-- hundreds of dollars of usage in an hour. With them, every tenant is
-- bounded to their plan tier and the operator can see consumption live
-- on the /settings page.
--
-- Idempotent: CREATE IF NOT EXISTS + ON CONFLICT DO NOTHING on backfill.

-- =============================================================================
-- usage_events — append-only log of every billable event
-- =============================================================================
CREATE TABLE IF NOT EXISTS usage_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL CHECK (event_type IN (
    'brave_query',
    'hunter_lookup',
    'unipile_account_active',
    'llm_tokens'
  )),
  units                 INTEGER NOT NULL DEFAULT 1,    -- e.g. token count for llm_tokens, 1 for everything else
  cost_cents_estimate   INTEGER,                       -- optional — populated when caller knows the cost
  metadata              JSONB,                         -- e.g. { route: '/api/pipeline/discover-batch', model: 'claude-sonnet-4-5', query: '...' }
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NOTE: an earlier draft of this migration had a `billing_month`
  -- generated column (date_trunc('month', created_at)::date), but Postgres
  -- rejects that expression as not-immutable when the source is TIMESTAMPTZ
  -- (date_trunc on tz-aware values depends on the session timezone). The
  -- monthly aggregations in src/lib/usage/events.ts already filter by
  -- `.gte('created_at', billingMonth.toISOString())` so the column wasn't
  -- needed — the composite index below covers those queries.
);

CREATE INDEX IF NOT EXISTS usage_events_org_type_created_idx
  ON usage_events (organisation_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_org_created_idx
  ON usage_events (organisation_id, created_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Operators can read their own org's events; nobody (not even owners)
-- writes from the client — all inserts go through the service role inside
-- src/lib/usage/log-event.ts.
DROP POLICY IF EXISTS usage_events_read_own_org ON usage_events;
CREATE POLICY usage_events_read_own_org ON usage_events
  FOR SELECT
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- =============================================================================
-- organisation_usage_caps — one row per organisation, defines the limits
-- =============================================================================
CREATE TABLE IF NOT EXISTS organisation_usage_caps (
  organisation_id              UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  plan_tier                    TEXT NOT NULL DEFAULT 'trial' CHECK (plan_tier IN ('trial', 'solo', 'team', 'unlimited')),
  cap_brave_queries_per_month  INTEGER NOT NULL DEFAULT 200,
  cap_hunter_lookups_per_month INTEGER NOT NULL DEFAULT 200,
  cap_unipile_accounts         INTEGER NOT NULL DEFAULT 2,
  cap_llm_tokens_per_month     BIGINT  NOT NULL DEFAULT 2000000,
  hard_block                   BOOLEAN NOT NULL DEFAULT true,  -- false = warn-only mode
  notes                        TEXT,                            -- admin scratchpad ("bumped to 5k brave for Koch pilot 2026-05-20")
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organisation_usage_caps ENABLE ROW LEVEL SECURITY;

-- Operators can read their own caps to see what they're limited to;
-- only the service role updates them.
DROP POLICY IF EXISTS usage_caps_read_own_org ON organisation_usage_caps;
CREATE POLICY usage_caps_read_own_org ON organisation_usage_caps
  FOR SELECT
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- =============================================================================
-- Backfill: ensure every existing org has a caps row at trial defaults
-- =============================================================================
INSERT INTO organisation_usage_caps (organisation_id)
SELECT id FROM organisations
ON CONFLICT (organisation_id) DO NOTHING;

-- =============================================================================
-- Trigger: auto-create a caps row whenever a new org is created
-- =============================================================================
CREATE OR REPLACE FUNCTION ensure_org_usage_caps()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO organisation_usage_caps (organisation_id)
  VALUES (NEW.id)
  ON CONFLICT (organisation_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organisations_ensure_usage_caps ON organisations;
CREATE TRIGGER organisations_ensure_usage_caps
  AFTER INSERT ON organisations
  FOR EACH ROW EXECUTE FUNCTION ensure_org_usage_caps();
