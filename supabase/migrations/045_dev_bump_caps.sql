-- Migration 045 — Dev-mode cap bump for the canonical org
--
-- Burned 2026-05-22: operator hit "llm_tokens cap exceeded" during a
-- heavy testing session (multiple wipe-and-rediscover cycles + scoring
-- + drafting attempts). The 2M-tokens/month trial default is sensible
-- for production tenants but too tight for active development.
--
-- This migration bumps the canonical Corporate AI Solutions org's caps
-- to dev-friendly values:
--   llm_tokens   2M  -> 50M / month
--   brave        200 -> 2000 / month
--   hunter       200 -> 2000 / month
--   unipile      2   -> 5 accounts
-- And logs the pre-state for forensics.
--
-- Idempotent: bump only fires if current cap is below the dev target.

DO $$
DECLARE
  org_id UUID;
  pre_llm BIGINT;
  pre_brave INT;
  pre_hunter INT;
  pre_unipile INT;
  current_month_usage BIGINT;
BEGIN
  SELECT id INTO org_id
    FROM public.organisations
   WHERE slug = 'corporate-ai-solutions-20260412';

  IF org_id IS NULL THEN
    RAISE EXCEPTION '[045] Canonical org corporate-ai-solutions-20260412 not found.';
  END IF;

  SELECT cap_llm_tokens_per_month, cap_brave_queries_per_month,
         cap_hunter_lookups_per_month, cap_unipile_accounts
    INTO pre_llm, pre_brave, pre_hunter, pre_unipile
    FROM public.organisation_usage_caps
   WHERE organisation_id = org_id;

  -- Sum this month's llm_tokens usage so the operator sees what they
  -- burned vs the new cap.
  SELECT COALESCE(SUM(units), 0) INTO current_month_usage
    FROM public.usage_events
   WHERE organisation_id = org_id
     AND event_type = 'llm_tokens'
     AND created_at >= date_trunc('month', now());

  RAISE NOTICE '[045] PRE  org=% llm_cap=% brave_cap=% hunter_cap=% unipile_cap=%',
    org_id, pre_llm, pre_brave, pre_hunter, pre_unipile;
  RAISE NOTICE '[045] PRE  llm_tokens used this month: %', current_month_usage;

  UPDATE public.organisation_usage_caps
     SET cap_llm_tokens_per_month   = GREATEST(cap_llm_tokens_per_month, 50000000),
         cap_brave_queries_per_month = GREATEST(cap_brave_queries_per_month, 2000),
         cap_hunter_lookups_per_month = GREATEST(cap_hunter_lookups_per_month, 2000),
         cap_unipile_accounts        = GREATEST(cap_unipile_accounts, 5),
         notes = COALESCE(notes || E'\n', '') || '2026-05-22 dev bump via migration 045: 2M->50M LLM tokens, 200->2000 Brave/Hunter, 2->5 Unipile accounts.',
         updated_at = now()
   WHERE organisation_id = org_id;

  RAISE NOTICE '[045] POST llm_cap=50M brave_cap=2000 hunter_cap=2000 unipile_cap=5 (bumped via GREATEST so any future manual bump beyond these stays)';
END $$;
