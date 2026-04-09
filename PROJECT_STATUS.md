# PartnerPilot — Project Status

Last updated: 2026-04-09
Session: Initial build

## What Was Done

### Reviews (Step 1)
- /office-hours: Design doc approved. Startup mode. Guillermo play validated. Vertical slice approach chosen.
- /plan-ceo-review: SELECTIVE EXPANSION mode. 5 cherry-picks accepted (demo mode, /playbook page, stats counter, radar chart, evidence trail). Key decisions: stage-per-request architecture, env vars only (no api_keys table), Anthropic tool_use pattern for MCP integration.
- /plan-eng-review: 1 issue (MCP integration → Anthropic tool_use). Test strategy defined. 3-lane parallelization mapped.
- /plan-design-review: Focused pass. 4 UI decisions (chat cards, approval gates, dashboard layout, radar chart).

### Infrastructure (Steps 2-8)
- GitHub: dennissolver/partner-pilot (private)
- Vercel: partner-pilot-three.vercel.app (auto-deploy on push)
- Supabase: rlwexqzoiqtbcvwqtqqf (ap-southeast-2)
- Schema: 6 tables (organisations, profiles, products, partners, agent_sessions, session_events) with RLS, indexes, triggers
- All env vars on Vercel: Supabase, Anthropic, Hunter, Brave, Resend
- .mcp.json configured (Brave, Hunter, Gmail)

### Application (Steps 9-13)
- Landing page with Guillermo attribution and CAS branding
- /playbook page (side-by-side mapping of playbook to product)
- Auth: login, signup, magic link, callback with auto org/profile creation
- Middleware: protects dashboard + API routes
- Dashboard: stats cards, action items, recent partners
- Partners table: logos (Hunter API), scores, status badges, contact info
- Partner detail: radar chart (SVG), contact, draft preview, scoring notes, evidence trail
- Products: CRUD with full ICP fields
- Sessions: guided/batch mode selection
- Settings: org profile, API connection status
- Export API: xlsx and csv
- Agent pipeline: categories + scoring stages via Anthropic API
- Partners API: upsert by domain

## What's Next

### Priority 1 — Session Detail Page (Agent Chat UI)
- src/app/(dashboard)/sessions/[id]/page.tsx
- Streaming card-based UI showing pipeline stages
- Approval gates as inline action cards
- Stage progress indicator

### Priority 2 — Remaining Pipeline API Routes
- /api/agent/search — Brave Search MCP for candidate discovery
- /api/agent/browse — Brave Search for company website research
- /api/agent/find-contact — Hunter MCP for email enrichment
- /api/agent/draft — Anthropic API for outreach drafting
- Each route: validate auth, run stage, log events, update session

### Priority 3 — MCP Tool Execution Layer
- src/lib/agent/brave-tools.ts — Execute brave_web_search tool calls
- src/lib/agent/hunter-tools.ts — Execute email_finder, domain_search, email_verifier
- Pattern: Anthropic tool_use → API route executes tool → feeds result back

### Priority 4 — Accepted Scope Expansions
- Demo mode at /demo/[product-slug] (public session replay)
- Pipeline stats counter on dashboard + landing page
- These are built into the plan but not yet implemented

### Priority 5 — Steps 14-20
- /design-review on live site
- /qa with browser testing
- /review pre-landing code review
- /health code quality check
- /ship PR creation
- /land-and-deploy
- /canary monitoring

## Pending Manual Config
- Supabase Auth redirect URLs: add https://partner-pilot-three.vercel.app/** and http://localhost:3000/**
- Supabase SMTP: configure with Resend (smtp.resend.com, port 465, user resend, password = Resend API key, sender updates@corporateaisolutions.com)

## Key Architecture Decisions
1. Stage-per-request: Each pipeline stage is a separate API call (not one long-running function). Client orchestrates.
2. Anthropic tool_use: Claude orchestrates via tool calls. API routes execute tools against MCP servers.
3. Env vars only: All API keys in Vercel env vars. No api_keys table in DB.
4. Vertical slice: Deploy working demo at every stage. Full SaaS scope but build order matters.

## Design Doc
~/.gstack/projects/PartnerPilot/denni-pre-init-design-20260409-094509.md

## CEO Plan
~/.gstack/projects/PartnerPilot/ceo-plans/2026-04-09-partner-pilot-mvp.md
