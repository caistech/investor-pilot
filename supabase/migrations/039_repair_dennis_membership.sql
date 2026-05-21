-- Migration 039 — Repair dennis@corporateaisolutions.com's org binding
--
-- After migration 038 deleted the duplicate "Corporate AI Solutions" org,
-- dennis@corporateaisolutions.com is hitting /dashboard 404 on sign-in.
-- Middleware's diagnostic log fires `no_resolvable_org`, meaning the
-- profile + memberships fallbacks both fail to resolve a usable slug.
--
-- Hypothesis: either profile.active_organisation_id still points at the
-- deleted org UUID (and the row no longer exists), or his canonical
-- membership was somehow lost in the cascade. Either way we want him
-- back in the canonical org `corporate-ai-solutions-20260412` with
-- owner role.
--
-- This migration logs the pre-state via RAISE NOTICE so the apply output
-- captures exactly what we were starting from (forensic record), then:
--   1. Ensures dennis has a memberships row in canonical (idempotent
--      via ON CONFLICT DO NOTHING)
--   2. Sets profile.active_organisation_id = canonical
--   3. Logs the post-state for verification
--
-- Idempotent + safe to re-run.

DO $$
DECLARE
  dennis_user_id        UUID;
  canonical_id          UUID;
  pre_profile_exists    BOOLEAN;
  pre_active_org        UUID;
  pre_membership_count  INT;
  pre_membership_orgs   TEXT;
  post_active_org       UUID;
  post_membership_count INT;
BEGIN
  SELECT id INTO dennis_user_id
    FROM auth.users
   WHERE lower(email) = 'dennis@corporateaisolutions.com';

  IF dennis_user_id IS NULL THEN
    RAISE EXCEPTION '[039] No auth.users row for dennis@corporateaisolutions.com — cannot repair.';
  END IF;

  SELECT id INTO canonical_id
    FROM public.organisations
   WHERE slug = 'corporate-ai-solutions-20260412';

  IF canonical_id IS NULL THEN
    RAISE EXCEPTION '[039] Canonical org corporate-ai-solutions-20260412 not found.';
  END IF;

  -- Pre-state snapshot
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = dennis_user_id)
    INTO pre_profile_exists;

  SELECT active_organisation_id INTO pre_active_org
    FROM public.profiles WHERE id = dennis_user_id;

  SELECT COUNT(*) INTO pre_membership_count
    FROM public.memberships WHERE user_id = dennis_user_id;

  SELECT string_agg(organisation_id::text || ':' || role, ', ')
    INTO pre_membership_orgs
    FROM public.memberships WHERE user_id = dennis_user_id;

  RAISE NOTICE '[039] PRE  user_id=%', dennis_user_id;
  RAISE NOTICE '[039] PRE  canonical_id=%', canonical_id;
  RAISE NOTICE '[039] PRE  profile_exists=% active_organisation_id=%',
    pre_profile_exists, pre_active_org;
  RAISE NOTICE '[039] PRE  membership_count=% orgs=[%]',
    pre_membership_count, COALESCE(pre_membership_orgs, 'none');

  -- Ensure canonical membership exists (owner role since dennis is
  -- presumably the owner of his own Corporate AI Solutions org).
  INSERT INTO public.memberships (user_id, organisation_id, role, created_at)
  VALUES (dennis_user_id, canonical_id, 'owner', now())
  ON CONFLICT (user_id, organisation_id) DO NOTHING;

  -- Ensure profile points at canonical (trigger 031 mirrors to legacy
  -- organisation_id automatically when active_organisation_id changes).
  UPDATE public.profiles
     SET active_organisation_id = canonical_id
   WHERE id = dennis_user_id
     AND (active_organisation_id IS DISTINCT FROM canonical_id);

  -- Post-state
  SELECT active_organisation_id INTO post_active_org
    FROM public.profiles WHERE id = dennis_user_id;
  SELECT COUNT(*) INTO post_membership_count
    FROM public.memberships WHERE user_id = dennis_user_id;

  RAISE NOTICE '[039] POST active_organisation_id=% membership_count=%',
    post_active_org, post_membership_count;
END $$;
