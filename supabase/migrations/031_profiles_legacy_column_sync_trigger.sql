-- Migration 031 — Sync trigger for profiles legacy columns during transition
--
-- Migration 030 restored profiles.organisation_id + profiles.role to match
-- active_organisation_id + memberships.role on a one-time basis. Going
-- forward, anything that updates profiles.active_organisation_id (the
-- /api/org/switch endpoint, the middleware org-context sync) would
-- silently desync the legacy columns until Lane C ships and nothing
-- reads them anymore.
--
-- This trigger keeps the legacy columns mirrored automatically whenever
-- active_organisation_id changes, so the ~70 routes still reading
-- profile.organisation_id continue to see the active org even as the
-- new code paths drive the writes.
--
-- Migration 032 (post-Lane-C dogfood) drops this trigger and both
-- legacy columns.
--
-- Idempotent: CREATE OR REPLACE + DROP/CREATE TRIGGER pattern.

CREATE OR REPLACE FUNCTION public.sync_profiles_legacy_org_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_role TEXT;
BEGIN
  IF NEW.active_organisation_id IS DISTINCT FROM OLD.active_organisation_id THEN
    NEW.organisation_id := NEW.active_organisation_id;

    IF NEW.active_organisation_id IS NULL THEN
      NEW.role := NULL;
    ELSE
      SELECT role INTO active_role
      FROM public.memberships
      WHERE user_id = NEW.id
        AND organisation_id = NEW.active_organisation_id;
      NEW.role := active_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_legacy_org_sync ON public.profiles;
CREATE TRIGGER profiles_legacy_org_sync
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profiles_legacy_org_columns();
