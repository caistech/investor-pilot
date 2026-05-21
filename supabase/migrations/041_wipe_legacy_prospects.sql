-- Migration 041 — Wipe legacy AU-sourced prospects from corporate-ai-solutions-20260412
--
-- Starting fresh: the existing 722 prospects accumulated under the prior
-- AU-biased discovery defaults. With the US-primary pivot in 08af560,
-- those rows are dead weight (low email-finder hit rate, wrong geography
-- for the operator's new strategy).
--
-- Mirrors src/app/api/admin/wipe-prospects/route.ts logic + adds
-- offering-side query_history reset so the LLM query generator stops
-- being anchored to AU-flavoured prior queries on the next run.
--
--   Deletes (FK-safe order, org-scoped):
--     outbound_messages → sequence_steps → inbound_messages → outreach_log →
--     session_events → partners → discovery_runs
--   Resets to '[]' (per offering in this org):
--     products.query_history, projects.query_history
--   Keeps:
--     organisations, profiles, products, projects (rows themselves),
--     product_sources, client_channels, sequence_templates, audit_events
--
-- Logs pre-counts via RAISE NOTICE so the apply log captures exactly what
-- got nuked (forensic record). Single transaction — rolls back atomically
-- on any guard failure.
--
-- Idempotent: re-running is safe (all DELETEs are no-ops when source is empty).

DO $$
DECLARE
  org_id UUID;
  cnt_partners INT;
  cnt_outbound INT;
  cnt_steps INT;
  cnt_inbound INT;
  cnt_outreach INT;
  cnt_sessions INT;
  cnt_runs INT;
  del_outbound INT;
  del_steps INT;
  del_inbound INT;
  del_outreach INT;
  del_sessions INT;
  del_partners INT;
  del_runs INT;
BEGIN
  SELECT id INTO org_id
    FROM public.organisations
   WHERE slug = 'corporate-ai-solutions-20260412';

  IF org_id IS NULL THEN
    RAISE EXCEPTION '[041] Canonical org corporate-ai-solutions-20260412 not found.';
  END IF;

  -- Pre-state snapshot
  SELECT COUNT(*) INTO cnt_partners FROM public.partners WHERE organisation_id = org_id;
  SELECT COUNT(*) INTO cnt_outbound FROM public.outbound_messages WHERE organisation_id = org_id;
  SELECT COUNT(*) INTO cnt_steps    FROM public.sequence_steps   WHERE organisation_id = org_id;
  SELECT COUNT(*) INTO cnt_inbound  FROM public.inbound_messages WHERE organisation_id = org_id;
  SELECT COUNT(*) INTO cnt_outreach FROM public.outreach_log     WHERE organisation_id = org_id;
  SELECT COUNT(*) INTO cnt_runs     FROM public.discovery_runs   WHERE organisation_id = org_id;
  SELECT COUNT(*) INTO cnt_sessions
    FROM public.session_events
   WHERE partner_id IN (SELECT id FROM public.partners WHERE organisation_id = org_id);

  RAISE NOTICE '[041] org_id=% (corporate-ai-solutions-20260412)', org_id;
  RAISE NOTICE '[041] PRE  partners=% outbound=% steps=% inbound=% outreach=% sessions=% runs=%',
    cnt_partners, cnt_outbound, cnt_steps, cnt_inbound, cnt_outreach, cnt_sessions, cnt_runs;

  -- Delete in FK-safe order. partners is the hub — children first.
  WITH d AS (DELETE FROM public.outbound_messages WHERE organisation_id = org_id RETURNING 1)
  SELECT COUNT(*) INTO del_outbound FROM d;

  WITH d AS (DELETE FROM public.sequence_steps   WHERE organisation_id = org_id RETURNING 1)
  SELECT COUNT(*) INTO del_steps    FROM d;

  WITH d AS (DELETE FROM public.inbound_messages WHERE organisation_id = org_id RETURNING 1)
  SELECT COUNT(*) INTO del_inbound  FROM d;

  WITH d AS (DELETE FROM public.outreach_log     WHERE organisation_id = org_id RETURNING 1)
  SELECT COUNT(*) INTO del_outreach FROM d;

  -- session_events scoped via partner_id (no direct org column)
  WITH d AS (
    DELETE FROM public.session_events
     WHERE partner_id IN (SELECT id FROM public.partners WHERE organisation_id = org_id)
     RETURNING 1
  )
  SELECT COUNT(*) INTO del_sessions FROM d;

  WITH d AS (DELETE FROM public.partners         WHERE organisation_id = org_id RETURNING 1)
  SELECT COUNT(*) INTO del_partners FROM d;

  WITH d AS (DELETE FROM public.discovery_runs   WHERE organisation_id = org_id RETURNING 1)
  SELECT COUNT(*) INTO del_runs     FROM d;

  -- Reset offering-side query_history so the next discovery batch starts
  -- with a blank slate instead of being anchored to AU-flavoured prior
  -- queries. JSONB column is reset to empty array, not deleted.
  UPDATE public.products SET query_history = '[]'::jsonb WHERE organisation_id = org_id;
  UPDATE public.projects SET query_history = '[]'::jsonb WHERE organisation_id = org_id;

  RAISE NOTICE '[041] DEL  partners=% outbound=% steps=% inbound=% outreach=% sessions=% runs=%',
    del_partners, del_outbound, del_steps, del_inbound, del_outreach, del_sessions, del_runs;
  RAISE NOTICE '[041] RESET products.query_history + projects.query_history to []';

  -- Audit trail — leave a clear marker that this wipe happened.
  INSERT INTO public.audit_events (organisation_id, actor, action, resource_type, resource_id, payload)
  VALUES (
    org_id,
    'migration:041',
    'admin.prospects_wiped',
    'organisation',
    org_id,
    jsonb_build_object(
      'reason', 'US-primary pivot; clearing AU-biased legacy backlog',
      'pre_counts', jsonb_build_object(
        'partners', cnt_partners,
        'outbound_messages', cnt_outbound,
        'sequence_steps', cnt_steps,
        'inbound_messages', cnt_inbound,
        'outreach_log', cnt_outreach,
        'session_events', cnt_sessions,
        'discovery_runs', cnt_runs
      ),
      'deleted', jsonb_build_object(
        'partners', del_partners,
        'outbound_messages', del_outbound,
        'sequence_steps', del_steps,
        'inbound_messages', del_inbound,
        'outreach_log', del_outreach,
        'session_events', del_sessions,
        'discovery_runs', del_runs
      )
    )
  );
END $$;
