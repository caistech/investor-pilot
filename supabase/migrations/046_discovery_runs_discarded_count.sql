-- 2026-05-21: surface the silent-discard count alongside the rest of the
-- discovery_runs telemetry. The runner has been logging `candidates_discarded`
-- since the strict 2-bucket prospects contract shipped (Brave-sourced rows
-- discarded when out_of_scope OR no email OR no real contact name) but the
-- number never made it to the DB — operators saw the post-discard count
-- only and asked "where did the other 90% of finds go?" This column closes
-- the gap so the funnel is honest in the UI.
--
-- Nullable; existing rows have no value (they pre-date the discard logging).

ALTER TABLE public.discovery_runs
  ADD COLUMN IF NOT EXISTS candidates_discarded INTEGER;
