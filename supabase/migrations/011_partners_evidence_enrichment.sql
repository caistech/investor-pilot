-- Migration 011 — partners evidence enrichment (Option 1 deep-read)
--
-- Adds the columns needed to power per-prospect message personalization.
-- Two parallel tracks:
--
--   1. LinkedIn deep-read (Unipile /users/{id} + /users/{id}/posts) — populated
--      for partners with source IN ('linkedin','sales_nav'). Surfaces recent
--      posts, connection date, mutual count, and (for 1st-degree only)
--      the contact's actual email.
--
--   2. Brave firm-enrichment — populated for source = 'brave' rows that lack
--      a LinkedIn URL. Stores firm-level news + named deals discovered via
--      targeted Brave queries.
--
-- Used by the orchestrator at sequence-assign time. Rendered into warm openers
-- and cold credit-signals by src/lib/sequencer/render.ts.
--
-- Idempotent: every column is wrapped in IF NOT EXISTS.

DO $$
BEGIN
  -- LinkedIn deep-read columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_about') THEN
    ALTER TABLE public.partners ADD COLUMN profile_about TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_recent_posts') THEN
    ALTER TABLE public.partners ADD COLUMN profile_recent_posts JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_email') THEN
    ALTER TABLE public.partners ADD COLUMN profile_email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_connected_at') THEN
    ALTER TABLE public.partners ADD COLUMN profile_connected_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_shared_connections_count') THEN
    ALTER TABLE public.partners ADD COLUMN profile_shared_connections_count INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_follower_count') THEN
    ALTER TABLE public.partners ADD COLUMN profile_follower_count INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='profile_engagement_flags') THEN
    ALTER TABLE public.partners ADD COLUMN profile_engagement_flags JSONB;
  END IF;

  -- Brave firm-enrichment columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='firm_recent_news') THEN
    ALTER TABLE public.partners ADD COLUMN firm_recent_news JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='firm_named_deals') THEN
    ALTER TABLE public.partners ADD COLUMN firm_named_deals JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='firm_about') THEN
    ALTER TABLE public.partners ADD COLUMN firm_about TEXT;
  END IF;

  -- Bookkeeping
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='evidence_enriched_at') THEN
    ALTER TABLE public.partners ADD COLUMN evidence_enriched_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='evidence_enrichment_status') THEN
    ALTER TABLE public.partners ADD COLUMN evidence_enrichment_status TEXT
      CHECK (evidence_enrichment_status IN ('success', 'partial', 'failed', 'unavailable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partners' AND column_name='evidence_enrichment_source') THEN
    ALTER TABLE public.partners ADD COLUMN evidence_enrichment_source TEXT
      CHECK (evidence_enrichment_source IN ('linkedin', 'brave', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN public.partners.profile_recent_posts IS
  'Up to 5 most recent LinkedIn posts as [{text, parsed_datetime, is_repost, author_name, share_url}]. Set by Unipile deep-read orchestrator at sequence-assign time. Highest-leverage signal for warm-DM personalization — referencing a real post outperforms generic role-based openers.';

COMMENT ON COLUMN public.partners.profile_email IS
  'Email returned by Unipile /users/{id} contact_info. Available for 1st-degree connections only. Auto-fills contact_email for warm sequences, replacing Hunter.io for that path.';

COMMENT ON COLUMN public.partners.evidence_enrichment_status IS
  'success = both fields populated. partial = enrichment ran but returned thin data (e.g. profile fetched but no posts). failed = retryable error. unavailable = no path to enrichment (e.g. Brave-sourced with no LinkedIn URL and Brave firm-enrichment also empty).';

-- Index to find rows that have not yet been enriched. Used by the orchestrator
-- to skip re-enrichment when partners are re-assigned later.
CREATE INDEX IF NOT EXISTS idx_partners_evidence_enriched_at
  ON public.partners(organisation_id, evidence_enriched_at)
  WHERE evidence_enriched_at IS NULL;
