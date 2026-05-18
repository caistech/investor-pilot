-- Migration 030 — Restore profiles.organisation_id + profiles.role for transition window
--
-- Migration 029 NULLed these columns expecting "missed grep sites fail
-- closed at 403." That plan only works AFTER every existing route is
-- swapped to read from memberships + active_organisation_id. Until Lane C
-- of the multi-org refactor lands those swaps, the legacy columns are
-- still the source of truth for ~70 routes.
--
-- This migration syncs the legacy columns back from the new sources:
--   profiles.organisation_id      ← profiles.active_organisation_id
--   profiles.role                 ← memberships.role for that active org
--
-- Migration 031 (separate PR, post-Lane-C dogfood) will drop the legacy
-- columns once nothing reads from them anymore.
--
-- Idempotent: re-running is a no-op once values are in sync.

UPDATE public.profiles p
SET organisation_id = p.active_organisation_id
WHERE p.organisation_id IS DISTINCT FROM p.active_organisation_id
  AND p.active_organisation_id IS NOT NULL;

UPDATE public.profiles p
SET role = m.role
FROM public.memberships m
WHERE m.user_id = p.id
  AND m.organisation_id = p.active_organisation_id
  AND p.role IS DISTINCT FROM m.role;
