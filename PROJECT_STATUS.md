# PartnerPilot — Project Status

Last updated: 2026-04-11 08:15 AEST
Session: Agentic rewrite session

## Architecture: Streaming Agentic (SHIPPED)
- Single `/api/agent/run` SSE endpoint replaces 11 old pipeline routes
- Claude with tool_use controls the flow
- Kira memory pattern: agent_messages + agent_memories tables + get_agent_context RPC
- 25s timeout chunking with auto-continue
- Plan: `C:\Users\denni\.claude\plans\zazzy-humming-milner.md`

## What's Working
- Agent starts, generates categories, searches Brave, screens, scores partners
- Events stream to UI in real-time via SSE
- Partner records save to Supabase (confirmed: counters update in sidebar)
- Kira memory tables created and RPC functional
- Retry logic for Anthropic 529 errors
- Event schemas in system prompt for consistent rendering
- Message window orphan trimming (both ends)
- 50-message context window for resume

## Known Issues (Fix Next Session)

### 1. Session not found on resume (CRITICAL)
- Error: `404 {"error":"Session not found"}` on auto-continue after timeout
- Likely: Supabase auth cookie expiring between chunks, or authenticateAndGetDb failing
- Fix: Debug auth on resume path, consider session token for auto-continue

### 2. OpenRouter integration (DEFERRED)
- SDK base URL override returns 404 (endpoint doesn't exist on OpenRouter)
- OpenAI format translation caused 500 errors
- Reverted to direct Anthropic. Revisit later.

### 3. Platform-trust integration (NOT STARTED)
- Plan includes wrapping tools with audit logging, rate limiting, cost metering
- Requires @platform-trust/middleware from C:\Users\denni\PycharmProjects\platform-trust

## Key Files
- `src/app/api/agent/run/route.ts` — SSE agent endpoint
- `src/lib/agent/tools.ts` — 9 tool definitions + executeTool
- `src/lib/agent/system-prompt.ts` — discovery protocol instructions
- `src/lib/agent/context.ts` — message reconstruction with orphan trimming
- `src/lib/agent/memory.ts` — Kira pattern (getAgentContext, saveMessage, saveMemory)
- `src/app/(dashboard)/sessions/[id]/page.tsx` — SSE event renderer (~570 lines)
- `supabase/migrations/003_agent_memory.sql` — memory tables + RPC

## What Was Deleted (Old Pipeline)
- 11 per-stage API routes (categories, search, screen, score, browse, find-contact, select-motion, draft, draft-list, update-stage)
- src/lib/agent/pipeline.ts (860 lines)
- ~1000 lines of client-side orchestration code

## Next Steps
1. **Fix session-not-found on resume** — debug authenticateAndGetDb on auto-continue
2. **Test full end-to-end run** — categories through to draft emails
3. **Add platform-trust middleware**
4. **Polish UI** — event rendering, error messages
5. **Ship for real partner discovery**

## Related Work
- Partner Portal Brief: `C:\Users\denni\PycharmProjects\R-and-D-Tax-Eligibility-Work-Recording\PARTNER_PORTAL_BRIEF.md`
- Platform Trust: `C:\Users\denni\PycharmProjects\platform-trust`
- Kira Memory: `C:\Users\denni\PycharmProjects\Kira`

## Key Architecture Decisions
1. Agentic over pipeline: Claude controls flow via tool_use, not fixed stages
2. Kira memory pattern: DB is source of truth, each invocation is stateless
3. 25s timeout chunking: auto-continue via SSE events
4. Direct Anthropic SDK: OpenRouter deferred due to API incompatibility
5. 50-message context window for resume conversations
