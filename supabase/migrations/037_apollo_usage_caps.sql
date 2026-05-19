-- 037 — Apollo.io usage caps.
--
-- Apollo joins Brave + Hunter as a cost-driving external service. Two
-- meters per org per month:
--   apollo_search       — People API Search calls. FREE at Apollo but
--                         still capped here to keep a runaway loop from
--                         flooding their rate limits. 1000/mo default.
--   apollo_enrichment   — People Enrichment calls. Costs 1 credit per
--                         email reveal. Default cap mirrors the
--                         185-credit base monthly plan.
--
-- Set higher in `organisation_usage_caps` for paying tiers. The hard
-- block in checkCap() applies when hard_block=true (current trial).

ALTER TABLE organisation_usage_caps
  ADD COLUMN IF NOT EXISTS cap_apollo_searches_per_month INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE organisation_usage_caps
  ADD COLUMN IF NOT EXISTS cap_apollo_enrichments_per_month INTEGER NOT NULL DEFAULT 185;

COMMENT ON COLUMN organisation_usage_caps.cap_apollo_searches_per_month IS
  'Apollo People API Search calls per billing month. Free at Apollo; capped to limit rate-limit exposure. See src/lib/agent/apollo-tools.ts.';
COMMENT ON COLUMN organisation_usage_caps.cap_apollo_enrichments_per_month IS
  'Apollo People Enrichment calls per billing month. 1 credit per successful email reveal. See src/lib/agent/apollo-tools.ts + src/lib/agent/email-finder.ts.';
