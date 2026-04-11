# PartnerPilot — Hybrid Stage Pipeline

## Architecture

PartnerPilot is a Next.js 14 app on Vercel with Supabase (auth + DB).
It helps founders find channel partners, enrich contacts, draft outreach,
send emails, and track replies.

The pipeline is stage-by-stage with explicit user action between each step.
No agentic loops. No SSE streaming. No conversation state management.

```
Stage 1: DISCOVER  → POST /api/pipeline/discover
Stage 2: ENRICH    → POST /api/pipeline/enrich
Stage 3: DRAFT     → POST /api/pipeline/draft
Stage 4: SEND      → POST /api/pipeline/send
Stage 5: TRACK     → GET|PATCH /api/pipeline/track
```

Claude is used only for one-shot calls (scoring in Stage 1, drafting in Stage 3).
Everything else is deterministic code.

## Key Files

### Pipeline Routes
- `src/app/api/pipeline/discover/route.ts` — Brave Search + Claude one-shot scoring
- `src/app/api/pipeline/enrich/route.ts` — batch Hunter.io email lookup
- `src/app/api/pipeline/draft/route.ts` — Claude one-shot draft generation
- `src/app/api/pipeline/send/route.ts` — create outreach entry, mark sent
- `src/app/api/pipeline/track/route.ts` — check status, mark replied/bounced

### DB Helpers
- `src/lib/db/partners.ts` — upsertPartner, updateContact, saveDraft, computeWeightedScore
- `src/lib/db/outreach.ts` — createOutreachEntry, markOutreachSent, markOutreachReplied

### External Service Wrappers
- `src/lib/agent/brave-tools.ts` — Brave Search API
- `src/lib/agent/hunter-tools.ts` — Hunter.io email finder + domain search
- `src/lib/agent/db.ts` — Supabase auth + service client helper

### UI
- `src/app/(dashboard)/partners/page.tsx` — partners list (server component)
- `src/components/partners/pipeline-table.tsx` — filter tabs, batch select, action bar (client)
- `src/app/(dashboard)/partners/[id]/page.tsx` — partner detail with radar chart
- `src/components/partners/draft-editor.tsx` — inline draft editor + send button (client)
- `src/components/company-logo.tsx` — logo with error fallback (client)

## Database Schema

### partners table
Stores all partner companies with scoring, contact, and draft data.
Status flow: `scored → contact_found → contact_partial → draft_ready → sent → replied → follow_up_due → meeting_booked → closed_won/lost`

### outreach_log table
Tracks every email sent: type (first_touch, follow_up), status (queued → sent → replied/bounced/failed), Gmail thread/message IDs, follow-up due dates.

### Status Sync Rule
When outreach_log.status reaches 'replied', update partners.status to 'replied'.
When sent > 7 days with no reply, partners.status becomes 'follow_up_due'.

## LLM Configuration

Uses OpenRouter as primary provider (falls back to direct Anthropic).
One-shot calls only — no tool_use, no agentic loops, no message windows.

- `OPENROUTER_API_KEY` — primary
- `ANTHROPIC_API_KEY` — fallback
- `AGENT_MODEL` — model ID (default: anthropic/claude-sonnet-4-20250514)

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase client
- `SUPABASE_SERVICE_ROLE_KEY` — for API route DB operations (bypasses RLS)
- `OPENROUTER_API_KEY` — LLM provider
- `ANTHROPIC_API_KEY` — LLM fallback
- `BRAVE_API_KEY` — web search
- `HUNTER_API_KEY` — email enrichment

## Product Context

PartnerPilot is built for R&D Tax Tracker by Corporate AI Solutions.
R&D Tax Tracker helps Australian businesses track R&D work effort
and expenses for ATO R&D Tax Incentive compliance.

ICP: 5-200 employee Australian tech/manufacturing/biotech companies.
Buyer: CFO, Finance Manager, or Founder.

## Scoring Formula

Weighted score = overlap*0.3 + complementarity*0.25 + readiness*0.2 + reachability*0.15 + leverage*0.1

Each dimension is 1-10, scored by Claude one-shot call during discovery.
The weighted formula is computed in JS (deterministic).

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
