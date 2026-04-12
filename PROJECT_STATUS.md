# InvestorPilot — Project Status

Last updated: 2026-04-12 AEST

## Current State

Forked from PartnerPilot. Rebranded for investor sourcing (F2K Housing Development Fund).
All migrations applied to new Supabase instance. Vercel project linked. Auth configured.
Scoring dimensions updated for investor/advisor context.

### What Works
- Partner discovery: categories, search, screening, scoring (via agent sessions)
- Partners page: filter tabs (All/Scored/Enriched/Drafted/Sent/Replied), search bar,
  partner type filter, batch select with "Enrich Selected" / "Draft Selected"
- Partner detail: radar chart, contact info, inline draft editor with send button
- Pipeline API routes: /api/pipeline/discover, enrich, draft, send, track
- Agent SSE endpoint: /api/agent/run with OpenRouter (Anthropic fallback)
- Hunter.io email enrichment (HUNTER_API_KEY)
- Brave Search company discovery (BRAVE_SEARCH_API_KEY)
- Supabase auth, RLS, outreach_log table
- Inline draft editor in session detail page (new: edit + send in-flow)
- Premature completion guard (nudges agent to continue if no drafts yet)
- 403/429 rate limit recovery with auto-resume

### Known Issues (Fix Next Session)

1. **Client-side crash on session page** — old draft_created events missing new fields
   (domain, body, contact_name, contact_email). The InlineDraftCard component needs
   null guards. Quick fix: add `|| ''` defaults to the event_data destructuring.

2. **Agent sometimes stops after scoring** — premature completion guard added but needs
   testing. The guard nudges the agent to continue from Phase 5 if no drafts exist.

3. **Domain mismatch on save_contact/save_draft** — fuzzy matching added (tries exact,
   then www. prefix, then ilike) but needs end-to-end testing.

4. **Counter tracking** — now counts both 'created' and 'updated' saves, but still
   sometimes shows 0 contacts when contacts were actually found.

### Architecture
- Agent sessions: SSE endpoint, Claude with tool_use, Kira memory pattern
- Pipeline routes: deterministic API calls for manual batch operations
- Both coexist: sessions for guided AI flow, pipeline routes for manual control
- OpenRouter primary, Anthropic fallback for LLM
- 60s Vercel timeout, 55s agent timeout with auto-continue

## Key Files
- `src/app/api/agent/run/route.ts` — SSE agent endpoint (with sanitiser + guards)
- `src/app/api/pipeline/` — deterministic pipeline routes
- `src/lib/agent/tools.ts` — tool definitions + execution with error handling
- `src/lib/agent/system-prompt.ts` — discovery protocol (8 phases)
- `src/lib/agent/context.ts` — forward-walk message sanitiser
- `src/lib/agent/memory.ts` — Kira pattern context recovery
- `src/lib/db/partners.ts` — partner upsert, contact, draft helpers
- `src/lib/db/outreach.ts` — outreach tracking + status sync
- `src/app/(dashboard)/sessions/[id]/page.tsx` — session detail + inline drafts
- `src/components/partners/pipeline-table.tsx` — filter tabs, search, batch select
- `src/components/partners/draft-editor.tsx` — draft editor on partner detail
- `supabase/migrations/004_outreach_log.sql` — outreach tracking table + RLS

## Environment
- Vercel: investorpilot.vercel.app (corporate-ai-solutions org)
- Supabase: azelomanmlywwzbpkksy (Seoul)
- Env vars: OPENROUTER_API_KEY, ANTHROPIC_API_KEY, BRAVE_SEARCH_API_KEY,
  HUNTER_API_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY

## Priority for Next Session
1. Fix the client-side crash (null guards on draft event fields)
2. Test full agent session end-to-end (all 8 phases)
3. If agent is still flaky, fall back to batch pipeline on /partners page
4. Either way: get 10 emails actually drafted, reviewed, and queued for send
