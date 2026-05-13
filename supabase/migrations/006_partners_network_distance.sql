-- Migration 006 — partners.network_distance
--
-- Tier-prioritised discovery: the operator's 1st-degree LinkedIn connections
-- are the highest-priority source (they know us → no connection request,
-- no daily cap on DMs to existing connections, higher reply rates). Then
-- 2nd-degree (warm cold), then cold (3rd+ / search).
--
-- See docs/sprint-0/12-discovery-architecture.md for the full architecture.
-- The renderer picks a warm-DM template (3 steps, no connect step) for
-- network_distance='1st' partners and the cold sequence template for others.
--
-- Per CLAUDE.md: idempotent. Wrap ADD COLUMN in IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'partners'
      AND column_name = 'network_distance'
  ) THEN
    ALTER TABLE public.partners
      ADD COLUMN network_distance text
      CHECK (network_distance IN ('1st', '2nd', 'cold'));

    COMMENT ON COLUMN public.partners.network_distance IS
      'LinkedIn relationship tier at time of discovery. 1st = direct connection (skip connect step, warm DM only). 2nd = mutual connection visible (cold sequence, higher accept rate). cold = no path (cold sequence). NULL = legacy row from before tier tracking.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_partners_network_distance
  ON public.partners(organisation_id, network_distance)
  WHERE network_distance IS NOT NULL;
