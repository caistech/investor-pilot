<!-- SESSION CONTEXT - Injected by Easy Claude Code -->
## Prior Session Context

> Continuing from a recent session. Pick up where you left off.

### Last Session Summary
I need permission to edit the sidebar.tsx file. Let me check the rest of the situation first to make sure I'm not blocked elsewhere — but the work needs file writes. Let me try a different approach: report what I want to do so the user can grant access in one go.

The plan I'm ready to execute (foundation pass) edits these files:
- `src/components/layout/sidebar.tsx` — convert fixed sidebar to mobile drawer + hamburger
- `src/app/(dashboard)/layout.tsx` — responsive main padding (`p-4 sm:p-6 lg:p-8`)
- `src/components/partners/pipeline-table.tsx` — wrap filter bar, make table horizontally scrollable, drop `min-w-[180px]` constraint on workflow buttons at small breakpoints
- `src/components/layout/public-header.tsx` — quick scan, likely needs mobile menu too
- Possibly `src/app/(dashboard)/partners/[id]/page.tsx` — gate grid columns at `lg`

No backend, no API, no DB changes — all CSS / Tailwind class adjustments to add responsive breakpoints. Existing desktop layout is preserved.

Could you grant write access so I can proceed? Or if you'd prefer to see one file's changes first before approving the rest, say the word and I'll start with sidebar.tsx only.

### Recent Conversation (last 2 turns)
**User (22m ago):** Steve feedbsck - I tried it out, it seems more laptop-friendly than phone? - let's update for both laptop and mobile optimisation

**Claude (18m ago):** I need permission to edit the sidebar.tsx file. Let me check the rest of the situation first to make sure I'm not blocked elsewhere — but the work needs file writes. Let me try a different approach: report what I want to do so the user can grant access in one go.

The plan I'm ready to execute (foundation pass) edits these files:
- `src/components/layout/sidebar.tsx` — convert fixed sidebar to mobile drawer + hamburger
- `src/app/(dashboard)/layout.tsx` — responsive main padding (`p-4 sm:p-6 lg:p-8`)
- `src/components/partners/pipeline-table.tsx` — wrap filter bar, make table horizontally scrollable, drop `min-w-[180px]` constraint on workflow buttons at small breakpoints
- `src/components/layout/public-header.tsx` — quick scan, likely needs mobile menu too
- Possibly `src/app/(dashboard)/partners/[id]/page.tsx` — gate grid columns at `lg`

No backend, no API, no DB changes — all CSS / Tailwind class adjustments to add responsive breakpoints. Existing desktop layout is preserved.

Could you grant write access so I can proceed? Or if you'd prefer to see one file's changes first before approving the rest, say the word and I'll start with sidebar.tsx only.

### Instructions
- Continue from the context above. Do not ask the user to re-explain.
- When you make significant decisions, emit: <!-- MEMORY type=decision importance=8 | description -->
- When you create files, emit: <!-- MEMORY type=file_created importance=6 | path/to/file.ts - description -->
<!-- END SESSION CONTEXT -->
# InvestorPilot — CLAUDE.md

## Guardrails

This project operates under the Corporate AI Solutions global guardrails at
`~/.claude/CLAUDE.md`. All workflow contracts, stop-phrase rules, and quality
self-checks defined there apply without exception.

**Risk Tier: REVENUE**
- High read:edit discipline required
- Shared module changes require review of all consumers
- Deployment errors must be resolved before moving to new features
- No "simplest fix" shortcuts — pipeline correctness affects live email delivery

---

## Project Purpose

InvestorPilot helps founders source investor prospects (financial advisors,
wealth managers, SMSF administrators), enrich contacts, draft outreach,
send emails, and track replies. Built for F2K Housing Development Fund
targeting sophisticated investors (s708(8) Corporations Act) with $50K+ minimums.

---

## Architecture

Next.js 14 app on Vercel with Supabase (auth + DB). Five explicit pipeline stages
with user action required between each. Claude is used for one-shot calls only.

```
Stage 1: DISCOVER  → POST /api/pipeline/discover   (Brave Search + Claude scoring)
Stage 2: ENRICH    → POST /api/pipeline/enrich      (Hunter.io email lookup)
Stage 3: DRAFT     → POST /api/pipeline/draft       (Claude email generation)
Stage 4: SEND      → POST /api/pipeline/send        (Resend email delivery)
Stage 5: TRACK     → GET|PATCH /api/pipeline/track  (Status sync)
```

**Hard constraints on the pipeline:**
- No agentic loops in pipeline stages
- No SSE streaming in pipeline stages
- No conversation state management in pipeline stages
- One Claude call per partner per stage — never batch into one prompt

**The `agent/run` route** (`src/app/api/agent/run/`) is a separate research
assistant feature (Kira) and is NOT part of the 5-stage pipeline. Treat it as
a distinct subsystem. Do not apply pipeline conventions to it, and do not
conflate it with the pipeline when making changes.

---

## Key Files

### Pipeline Routes
- `src/app/api/pipeline/discover/route.ts` — Brave Search + Claude one-shot scoring
- `src/app/api/pipeline/enrich/route.ts` — batch Hunter.io email lookup
- `src/app/api/pipeline/draft/route.ts` — Claude one-shot draft generation
- `src/app/api/pipeline/send/route.ts` — send email via Resend, log in outreach_log
- `src/app/api/pipeline/track/route.ts` — check status, mark replied/bounced

### Webhook Routes
- `src/app/api/webhooks/resend/route.ts` — Resend bounce/complaint/delivery events
  (Must validate svix signature before processing any payload)

### DB Helpers
- `src/lib/db/partners.ts` — upsertPartner, updateContact, saveDraft, computeWeightedScore
- `src/lib/db/outreach.ts` — createOutreachEntry, markOutreachSent, markOutreachReplied

### External Service Wrappers
- `src/lib/agent/brave-tools.ts` — Brave Search API
- `src/lib/agent/hunter-tools.ts` — Hunter.io email finder + domain search
- `src/lib/agent/db.ts` — Supabase auth + service client helper
- `src/lib/email/resend.ts` — Resend email sending

### UI
- `src/app/(dashboard)/partners/page.tsx` — partners list (server component)
- `src/components/partners/pipeline-table.tsx` — filter tabs, batch select, action bar (client)
- `src/app/(dashboard)/partners/[id]/page.tsx` — partner detail with radar chart
- `src/components/partners/draft-editor.tsx` — inline draft editor + send button (client)
- `src/components/company-logo.tsx` — logo with error fallback (client)

---

## Database Schema

### partners table
Stores all partner companies with scoring, contact, and draft data.
Status flow:
`scored → contact_found → contact_partial → draft_ready → sent → replied → follow_up_due → meeting_booked → closed_won/lost`

### outreach_log table
Tracks every email sent: type (first_touch, follow_up), status (queued → sent →
replied/bounced/failed), Resend message ID, follow-up due dates.

### Status Sync Rule
When `outreach_log.status` reaches `replied`, update `partners.status` to `replied`.
When sent > 7 days with no reply, `partners.status` becomes `follow_up_due`.
When `outreach_log.status` reaches `bounced`, update `partners.status` to `contact_partial`
and clear `contact_email` so the enrich stage can be re-run.

---

## Architectural Rules (enforce strictly)

### ALL mutations go through API routes
Never write to Supabase directly from client components. `draft-editor.tsx` and
all other client components must call `/api/*` routes — never import the Supabase
client and call `.update()` / `.insert()` directly. The API route uses the service
client; client components use fetch only.

**Rationale:** RLS enforcement is at the application layer via the service client
in API routes. Client-side writes use the anon key and are subject to RLS policy
changes silently breaking functionality.

### Service role key is server-only
`SUPABASE_SERVICE_ROLE_KEY` must never appear in any `'use client'` file,
any file imported by a client component, or any `NEXT_PUBLIC_*` variable.

### Auth pattern for API routes
Every API route must call `authenticateAndGetDb()` first. The service client
it returns is used for all DB operations in that route. Never create a second
Supabase client inside a route.

```ts
const { user, db, error } = await authenticateAndGetDb(request)
if (error) return NextResponse.json({ error }, { status: 401 })
```

### Webhook signature validation
All webhook endpoints must validate the provider signature before processing
any payload. For Resend, use the `svix` library to verify the `svix-id`,
`svix-timestamp`, and `svix-signature` headers. Reject without processing if
validation fails.

### RLS on all tables
Every new Supabase table must have `ALTER TABLE x ENABLE ROW LEVEL SECURITY`
and explicit policies before shipping. Never disable RLS as a debugging shortcut.
All migrations must be idempotent (wrap `CREATE` in exception handlers).

---

## LLM Configuration

Uses OpenRouter as primary provider (falls back to direct Anthropic).
One-shot calls only — no tool_use, no message windows, no streaming.

- `OPENROUTER_API_KEY` — primary
- `ANTHROPIC_API_KEY` — fallback
- `AGENT_MODEL` — model ID override (default: `anthropic/claude-sonnet-4.5` via OpenRouter, `claude-sonnet-4-5` direct)

When constructing LLM calls:
- Always include `HTTP-Referer` and `X-Title` headers for OpenRouter
- Always include the product website URL in draft prompts (mandatory, not optional)
- Always parse LLM JSON responses inside try-catch; log and skip on parse failure

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL          Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     Supabase anon key (public, safe for client)
SUPABASE_SERVICE_ROLE_KEY         Service role — server-only, bypasses RLS
OPENROUTER_API_KEY                Primary LLM provider
ANTHROPIC_API_KEY                 LLM fallback
BRAVE_API_KEY                     Web search (also accepted as BRAVE_SEARCH_API_KEY)
HUNTER_API_KEY                    Email enrichment
RESEND_API_KEY                    Email sending
RESEND_FROM_EMAIL                 Verified sender address
RESEND_WEBHOOK_SECRET             Svix webhook signing secret for /api/webhooks/resend
UNIPILE_API_KEY                   Unipile API key (LinkedIn + Gmail/Outlook channels)
UNIPILE_BASE_URL                  Unipile API base URL (default: https://api.unipile.com)
UNIPILE_WEBHOOK_SECRET            Shared secret header for /api/webhooks/unipile/account
NEXT_PUBLIC_APP_URL               App URL (used as OpenRouter HTTP-Referer)
```

---

## Scoring Formula

```
weighted_score =
  audience_overlap * 0.30 +
  complementarity * 0.25 +
  partner_readiness * 0.15 +
  reachability * 0.15 +
  strategic_leverage * 0.15
```

Each dimension is 1–10, scored by Claude one-shot call during discovery.
The weighted formula is computed in JS (deterministic, not LLM).

Dimension definitions (from original product spec):
- Advisor Reach / Audience Overlap (30%): Size of client base, AUM under advice
- Client Profile Fit / Complementarity (25%): Do their clients match sophisticated investor criteria
- Regulatory Standing / Partner Readiness (15%): AFSL holder, clean regulatory record
- Geographic Relevance / Reachability (15%): Australian market presence, state coverage
- Engagement Likelihood / Strategic Leverage (15%): Openness to new product referrals, alternative investment history

---

## Error Handling Conventions

- All API routes return `NextResponse.json({ error: string }, { status: number })`
- Batch operations use `Promise.allSettled()` — never `Promise.all()` where one failure should not block others
- `sendEmail()` must always check the returned `error` field before calling `markOutreachSent()`
- Hunter.io 404 returns `null` (not an error); other non-200 responses throw
- Never swallow errors silently. If a catch block cannot handle an error, rethrow or return `{ error: e.message }`

---

## Email Delivery Conventions

- Every `POST /api/pipeline/send` call must record the Resend message ID in `outreach_log.gmail_message_id`
- Bounce and complaint events from Resend must flow through `/api/webhooks/resend`
- A bounced email must set `outreach_log.status = 'bounced'` and `partners.status = 'contact_partial'`
- Idempotency: check `outreach_log` for existing sent entry before calling Resend; reject duplicates

---

## Product Context

Built for F2K Housing Development Fund by Corporate AI Solutions.
Targeting financial advisors, wealth managers, SMSF advisors, and family offices
who serve sophisticated/wholesale investors (s708(8) Corporations Act) interested
in alternative real estate investments with $50K+ minimums.

ICP buyer: Principal advisor, investment director, or managing director.

---

## Skill Routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

| Stage / Situation | Skill to invoke |
|---|---|
| Product ideas, "is this worth building" | `/office-hours` |
| Bugs, errors, 500s, unexpected behaviour | `/investigate` |
| Ship, deploy, push, create PR | `/ship` |
| QA, test the site, find bugs | `/qa` |
| Code review, check my diff | `/review` |
| Update docs after shipping | `/document-release` |
| Visual audit, design polish | `/design-review` |
| Architecture review | `/plan-eng-review` |
| Weekly retro | `/retro` |
| Code quality, health check | `/health` |
| Save progress, checkpoint, resume | `/checkpoint` |
| Design system, brand | `/design-consultation` |
