-- Migration 024 — partners engagement tracking
--
-- The value-offer DNA we added means cold prospects can ACCEPT something
-- (free pilot, brief, intro) without yet committing to a meeting. That
-- transitional state — "engaged with the offer but not yet a meeting" —
-- has no first-class status today, so warm prospects vanish back into
-- the same follow-up cadence as cold ones. Loses signal + insults the
-- prospect with another cold-toned follow-up.
--
-- Add per-partner engagement fields:
--   engaged_at         — when the operator (or eventually the webhook
--                        tracker) marked the prospect as having taken
--                        up the offer
--   engagement_type    — what they engaged with (free text, e.g.
--                        'pilot_started', 'brief_downloaded',
--                        'reply_positive', 'manual')
--   engagement_note    — operator's free-text context on the engagement
--
-- A new partner.status value 'warm_engaged' is conceptually distinct from
-- 'replied' (which means an inbound message arrived) and 'meeting_booked'
-- (which is post-conversation). The status remains free-text — no CHECK
-- constraint to break — and the application layer uses it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, indexed for the new filter tab.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS engaged_at TIMESTAMPTZ;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS engagement_type TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS engagement_note TEXT;

CREATE INDEX IF NOT EXISTS idx_partners_engaged
  ON partners(organisation_id, engaged_at DESC)
  WHERE engaged_at IS NOT NULL;

COMMENT ON COLUMN partners.engaged_at IS
  'Set when the prospect accepted a value offer (pilot started, brief downloaded, positive reply). Distinct from replied (any inbound) and meeting_booked (post-conversation). Drives the Warm-engaged pipeline filter + warmer follow-up cadence.';
COMMENT ON COLUMN partners.engagement_type IS
  'What they engaged with. Free text — typical values: pilot_started, brief_downloaded, deck_requested, reply_positive, manual_flag, intro_made.';
COMMENT ON COLUMN partners.engagement_note IS
  'Operator context on the engagement — e.g. "took the pilot for their PortCo Acme, kickoff call scheduled for next week".';
