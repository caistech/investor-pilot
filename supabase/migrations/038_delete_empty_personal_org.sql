-- Migration 038 — Delete empty my-organisation-mp7oemls org
--
-- Context: the multi-org backfill in migration 029 auto-created personal
-- orgs for every user. dennis@corporateaisolutions.com ended up with two:
--   - corporate-ai-solutions-20260412 (canonical — all real work)
--   - my-organisation-mp7oemls       (empty / sparse personal org)
-- The personal org creates the confusion where the user lands on a
-- near-empty surface and assumes products got deleted. Delete it.
--
-- Safety guards:
--   1. Refuses if the canonical org doesn't exist (no safe re-anchor).
--   2. Refuses if the doomed org has memberships other than the owner
--      (someone else's workspace — never silently nuke).
--   3. Re-anchors any profile whose active_organisation_id points here
--      to the canonical org BEFORE delete; trigger 031 syncs legacy
--      organisation_id automatically.
--   4. NULLs agent_memories.organisation_id rows pointing here
--      (NO ACTION FK would otherwise block the delete).
--   5. All inside a single DO block + transaction — partial failure
--      rolls back. RAISE NOTICE for every step so the apply log shows
--      exactly what changed.
--
-- Idempotent: if no org with that slug exists, the block returns early.

DO $$
DECLARE
  doomed_id           UUID;
  doomed_name         TEXT;
  canonical_id        UUID;
  member_count        INT;
  reanchor_count      INT;
  memories_null_count INT;
BEGIN
  SELECT id, name INTO doomed_id, doomed_name
    FROM public.organisations
   WHERE slug = 'my-organisation-mp7oemls';

  IF doomed_id IS NULL THEN
    RAISE NOTICE '[038] No org with slug my-organisation-mp7oemls — nothing to delete.';
    RETURN;
  END IF;

  SELECT id INTO canonical_id
    FROM public.organisations
   WHERE slug = 'corporate-ai-solutions-20260412';

  IF canonical_id IS NULL THEN
    RAISE EXCEPTION '[038] Canonical org corporate-ai-solutions-20260412 not found — refusing to delete without a safe re-anchor target.';
  END IF;

  SELECT COUNT(*) INTO member_count
    FROM public.memberships
   WHERE organisation_id = doomed_id;

  IF member_count > 1 THEN
    RAISE EXCEPTION '[038] Doomed org % (%) has % members — refusing to delete a multi-member workspace. Manual review required.',
      doomed_name, doomed_id, member_count;
  END IF;

  RAISE NOTICE '[038] Doomed org: % (id=%, members=%)', doomed_name, doomed_id, member_count;
  RAISE NOTICE '[038] Canonical re-anchor target: corporate-ai-solutions-20260412 (id=%)', canonical_id;

  -- Re-anchor profiles whose active_organisation_id points at the doomed
  -- org. Only re-anchor users who ALREADY have a membership in canonical;
  -- the rest get set to NULL (effectively logged out of org context but
  -- still able to pick another org from the switcher).
  UPDATE public.profiles p
     SET active_organisation_id = CASE
           WHEN EXISTS (
             SELECT 1 FROM public.memberships m
              WHERE m.user_id = p.id AND m.organisation_id = canonical_id
           ) THEN canonical_id
           ELSE NULL
         END
   WHERE active_organisation_id = doomed_id;
  GET DIAGNOSTICS reanchor_count = ROW_COUNT;
  RAISE NOTICE '[038] Re-anchored % profile(s) off the doomed org', reanchor_count;

  -- NULL out agent_memories (NO ACTION FK would block CASCADE).
  UPDATE public.agent_memories
     SET organisation_id = NULL
   WHERE organisation_id = doomed_id;
  GET DIAGNOSTICS memories_null_count = ROW_COUNT;
  RAISE NOTICE '[038] NULLed organisation_id on % agent_memories row(s)', memories_null_count;

  -- Final delete. Cascades to: products, partners, outreach_log, projects,
  -- client_channels, sequence_templates, sequence_steps, sequences,
  -- outbound_messages, audit_events, discovery_runs, product_sources,
  -- org_usage_caps, memberships, invitations, intake_responses,
  -- agent_sessions. (Confirmed in migrations 001-034 — all
  -- organisation_id FKs declare ON DELETE CASCADE except the two cleared
  -- above.)
  DELETE FROM public.organisations WHERE id = doomed_id;
  RAISE NOTICE '[038] Deleted organisation %', doomed_id;
END $$;
