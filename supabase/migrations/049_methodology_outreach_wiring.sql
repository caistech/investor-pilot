-- Migration 049 — methodology outreach wiring (Session 2)
--
-- Wires CAS distributor-discovery methodology campaigns into IP's existing
-- 5-stage discovery + outreach engine. The activate route (POST
-- /api/methodology/campaigns/[id]/activate) discovers prospects for a campaign's
-- ICP, tags them with methodology_campaign_id, and drafts a research INVITE that
-- embeds the Connexions interview URL + the thin-MVP URL. Responses return via
-- the Connexions voice loop (post-call webhook → CAS sync), NOT via IP replies.
--
-- Additive + idempotent. RLS already enabled on both tables (service-role writes;
-- /api/methodology/* authenticates via METHODOLOGY_API_KEY).

-- 1. methodology_campaigns — carry the invite payload the outreach embeds.
ALTER TABLE methodology_campaigns
  ADD COLUMN IF NOT EXISTS mvp_url TEXT,
  ADD COLUMN IF NOT EXISTS connexions_interview_url TEXT;

-- 2. partners — tag prospects discovered for a methodology campaign, so the
--    activate route + research-invite draft scope to them and the normal
--    product/project dashboards don't surface methodology research prospects.
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS methodology_campaign_id UUID
    REFERENCES methodology_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partners_methodology_campaign
  ON partners(methodology_campaign_id)
  WHERE methodology_campaign_id IS NOT NULL;

COMMENT ON COLUMN methodology_campaigns.mvp_url IS
  'Thin-MVP URL embedded in the research invite (Gate-1 payload from CAS).';
COMMENT ON COLUMN methodology_campaigns.connexions_interview_url IS
  'Connexions voice-interview panel URL the invite points respondents to; responses return via the Connexions post-call webhook -> CAS sync.';
COMMENT ON COLUMN partners.methodology_campaign_id IS
  'Set when this prospect was discovered for a CAS methodology campaign (NULL for normal SDR prospects).';
