-- Migration 048 — methodology_campaigns table (IP-side state)
--
-- CAS's distributor-discovery methodology runs InvestorPilot as its validation
-- rail (see Corporate-AI-Solutions/docs/DISTRIBUTOR_DISCOVERY_METHODOLOGY.md).
-- For each portfolio product CAS wants to validate, it creates two campaigns
-- on IP — one targeting target-user archetypes, one targeting distributor
-- candidates. Each campaign carries its own ICP + question list.
--
-- This table holds the IP-side state for those campaigns. It's separate from
-- IP's existing `projects` and `products` tables because:
--   1. CAS owns the lifecycle (created/torn-down per methodology run; not
--      managed by IP's normal onboarding flow).
--   2. The org context is a CAS-internal methodology org, not a normal F2K
--      tenant. Keeping it isolated avoids confusing IP's existing dashboards.
--   3. Session 2 will wire actual outreach by creating a Project (or set of
--      Projects) under the methodology campaign when the operator chooses to
--      run the campaign. Until then, the campaign sits as a config object.
--
-- Service-role-only writes; API endpoints under /api/methodology/* authenticate
-- via METHODOLOGY_API_KEY (Bearer token) — see middleware allowlist (047 PR).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS methodology_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- CAS context — the portfolio product this campaign validates
    cas_product_slug TEXT NOT NULL,
    cas_card_id UUID,  -- nullable; CAS's methodology_hypothesis_cards.id

    -- Campaign type per methodology spec
    campaign_type TEXT NOT NULL CHECK (campaign_type IN ('target-user', 'distributor-candidate')),

    -- Campaign config (set on POST /api/methodology/campaigns)
    icp_description TEXT NOT NULL,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of question strings
    expected_response_count INT DEFAULT 30,
    channel_mix TEXT[] DEFAULT ARRAY['linkedin', 'email']::TEXT[],

    -- Lifecycle (Session 2 will progress these)
    status TEXT NOT NULL DEFAULT 'configured'
        CHECK (status IN ('configured', 'sourcing', 'sending', 'collecting', 'synthesized', 'paused')),

    -- Session 2 wiring — set when the operator promotes the campaign to an
    -- actual IP project for outreach execution. Null until then.
    ip_project_id UUID,
    ip_org_id UUID
);

CREATE INDEX IF NOT EXISTS idx_methodology_campaigns_product ON methodology_campaigns(cas_product_slug);
CREATE INDEX IF NOT EXISTS idx_methodology_campaigns_status ON methodology_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_methodology_campaigns_card ON methodology_campaigns(cas_card_id);

ALTER TABLE methodology_campaigns ENABLE ROW LEVEL SECURITY;
-- No anon policies; service-role bypasses RLS. API auth via METHODOLOGY_API_KEY.

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_methodology_campaigns_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS methodology_campaigns_updated_at ON methodology_campaigns;
CREATE TRIGGER methodology_campaigns_updated_at
  BEFORE UPDATE ON methodology_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_methodology_campaigns_updated_at();

COMMENT ON TABLE methodology_campaigns IS
  'IP-side state for CAS distributor-discovery methodology validation campaigns. Two campaigns per CAS portfolio product (target-user + distributor-candidate). Session 1 stores config; Session 2 wires actual outreach.';
