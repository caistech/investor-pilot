# InvestorPilot → Agentic Outreach Platform

**Planning and Execution Model for Claude Code**

---

## ⚠ POST-CEO-REVIEW + SENIOR DEBT PIVOT (2026-05-13) — READ FIRST

This plan has been through three reframings:
- 2026-05-12 v1 — original Affluent Connections / CHARM agentic replication
- 2026-05-12 v2 — CEO review re-anchored to "5 verified-investor meetings/week" objective, advisor channel, validation-gated wedge
- **2026-05-13 v3 — SENIOR DEBT PIVOT** per `docs/sprint-0/11-senior-debt-brief-v3.pdf` (signed off by Uwe). InvestorPilot's outreach now targets direct lenders + family office private debt allocators for the combined $18.7M Branscombe + Seafields senior facility.

The v3 brief supersedes the v2 advisor framing. Stamford Capital + Front Financial broker process stalled; InvestorPilot is the parallel direct-to-lender process. The $125K wholesale-investor channel is sourced via Uwe's own network and out of scope for InvestorPilot.

The sections below remain operational where they're audience-agnostic (architecture, validation gating, wedge approach). Where they're audience-specific (D2 placeholder ICP, D4 verification content, D5 scoring weights), v3 supersedes per the brief.

### Captured Decisions (with v3 senior-debt updates)

| # | Decision | v2 state | v3 update (2026-05-13) |
|---|---|---|---|
| D1 | **Approach C: validation-gated wedge** | In-scope | **Unchanged.** Sprint 0 + Phases 1-2 in-scope; Phases 3-6 deferred. |
| D2 | Placeholder ICP | Advisor — to be validated by Uwe | **SUPERSEDED** by Senior Debt Brief v3 Section 4 (lender ICP). |
| D3 | **LinkedIn + email co-equal from Phase 1** | Both channels Sprint 1 | **Unchanged** — both channels still required for lender funnel volume. |
| D4 | **Pre-meeting code-enforced verification** | Advisor sophistication declaration | **Content changes:** now verify lender legitimacy (allocation authority, not advisor sophistication). Architecture unchanged. |
| D5 | **Re-weight 5-dim scoring** | Client Quality 35 / Alt-History 25 / Reach 20 / Reg 15 / Geo 5 | **SUPERSEDED.** New weights per file 09 v3: Capital 25 / Asset-Class 25 / Track-Record 25 / Authority 15 / Reachability 10. Schema field names retained (tech debt). |
| D6 | **Parallel architecture, hard boundary** | Pipeline + agent stack parallel | **Unchanged.** CLAUDE.md rules preserved. |
| D7 | Persistence pattern (this file as living doc) | n/a | **Unchanged.** |

### Objective Reset — v3 SENIOR DEBT

**v3 headline (replaces v2 "5 meetings/week" framing):**

**Fill $18.7M combined senior debt platform across Branscombe ($16.2M) + Seafields ($2.5M) within 12-16 weeks** — approximately 7-11 documented lender commitments at $1-5M average ticket. See `docs/sprint-0/02-funnel-math.md` v3 for full lender-funnel model.

**Lender universe:** ~240-460 AU + APAC family offices / HNW private lenders / sub-$200M AUM private credit funds with documented AU property development debt exposure.

**Funnel math (v3 — lender channel):** Multi-channel (LinkedIn + email) per D3 yields ~1.7 documented commitments/week at F2K-bet conversion. Comfortably exceeds the 7-11 commitments needed in 12 weeks. Highest-leverage lever is email reply rate (driven by lender-ICP targeting precision + message quality).

### Validated Lender ICP (v3 — replaces v2 placeholder advisor ICP)

Per Senior Debt Brief v3 Section 4 (Uwe-signed):

- **Decision-maker:** Family office principal/CIO with personal allocation authority; HNW individual personally lending into property development; principal of a private debt vehicle.
- **Capital per cheque:** $1M-$5M typical; some $10M+.
- **Asset class:** Private debt — specifically AU property + development debt.
- **Risk position:** First-mortgage senior secured at 65-75% LVR.
- **Return target:** 8-11% p.a. coupon, contracted-term debt.
- **Decision cadence:** Weeks, not months. No slow committee.
- **Track record:** ≥1 AU property development debt position in past 36 months (strongest single predictor).
- **Geography:** Sydney HIGHEST, Melbourne HIGH, Singapore HIGH, Brisbane/Perth/Hong Kong MEDIUM, TAS/Geraldton LOW.

The $125K wholesale-investor channel (former v2 ICP) is sourced via Uwe's own network — out of scope for InvestorPilot's outreach.

### Sprint 0 (3-5 days, NEW — gates Sprint 1)

1. **ICP validation with Uwe + Dennis** — written brief with 20 "perfect-fit"
   advisors as truth set.
2. **F2K offering brief** — minimum, structure, wholesale exemption posture,
   AFSL status, who hosts meetings, success-per-meeting definition, messaging
   constraints.
3. **Funnel math sanity** — any prior F2K outreach conversion data; otherwise
   flag agency-norm assumptions as unvalidated.
4. **AFSL/legal review of Phase 1 message templates** — written sign-off.
   **Blocks Sprint 1 sends.**
5. **Unipile capability spike** — verify daily caps, warmup, health monitoring
   on a single throwaway target.
6. **Reuse audit** — open OMQ/PartnerPilot/OutreachReady repos (not deployed
   apps), confirm reuse claims or revise.

**Sprint 0 exit:** all six items complete in writing.

### Revised Sprint 1 Exit Criteria (replaces original "Dennis DMs himself" plumbing test)

- 10 hand-curated ICP prospects loaded with **re-weighted scoring (D5)**.
- Each prospect receives LinkedIn connection request + email touch (D3), both
  audit-logged via Platform Trust.
- Approval queue ships **mobile-friendly**, with pre-send compliance result
  surfaced as green/yellow/red with reason.
- **Kill switch tested:** operator can pause all channels in <10s from dashboard
  (`client_channels.status='paused'` enforced in middleware).
- **Evidence metric:** within 7 days of Sprint 1 ship, measure connection-accept
  rate, email-open rate, first-reply rate. If accept rate <20% or zero replies,
  **halt before Phase 2** and revisit ICP + messaging.

### Phase 2 Revisions

- **Inngest deferred.** Use cron + DB state machine until provably insufficient
  (>500 active sequences OR >7d step delays common).
- **Sequence template seeded for F2K vertical only.** Other verticals deferred
  to Phase 6 (white-label).
- **Verification state added** to sequence machine: `awaiting_verification`
  blocks meeting-stage advance until F2K Fund Tokenisation flow completes (D4).
- **Headline dashboard:** confirmed meetings this week vs 5/week target, funnel
  below (touches → accepted → replied → interested → verified → confirmed → held).
- **Multi-tenant schema** (tenant_id columns) from day 1, but not enforced until
  customer #2.

### Critical Pre-Send Gates (BLOCKERS before any real outbound)

1. AFSL/legal sign-off on Phase 1 message templates (Sprint 0 item 4).
2. ICP brief signed off by Uwe (Sprint 0 item 1).
3. Kill switch operationally tested (Sprint 1 deliverable).
4. Pre-migration RLS review of 7 new tables (Sprint 1 deliverable).

### Unrescued Failure Modes (require explicit handlers before Phase 2)

| Failure mode | Handler |
|---|---|
| OOO auto-reply misclassified | Until Phase 3 Inbox Agent ships, any reply pauses sequence for human review |
| Compliance filter block | Block + flag + pause sequence on that prospect; operator UX surfaces reason in approval queue |
| Calendar double-book at confirm | Phase 4 deferred; meanwhile use Calendly with hold logic; manual booking logged in `outreach_log` |
| Meeting confirmed but no-show | Add `meeting_held` boolean distinct from `meeting_confirmed` in schema; report both metrics on headline dashboard |
| Late reply (>14d post-sequence) | Re-engagement state in sequencer; route to "warm reopen" template |
| Bad sequence detected mid-flight | Kill switch (above) |

### Deferred (NOT in scope of validated wedge — see TODOS.md when created)

- Phase 3 Inbox Agent (gated by Phase 2 paid pilot revenue). Begin collecting
  labelled reply examples from Sprint 1 day 1 for eval set.
- Phase 4 Calendar Agent (gated by Phase 3 ship).
- Phase 5 Credibility scaffolding (gated by 30d clean Phase 2 operation).
- Phase 6 White-label generator + MCP server (gated by customer #2).
- Inngest (gated by scale signal).
- Multi-tenant enforcement (gated by customer #2).

### Recommended Next Reviews

- **After Sprint 0 produces ICP + F2K offering briefs:** re-run `/plan-ceo-review`
  with validated inputs (this review used a placeholder ICP).
- **Before Sprint 1 implementation begins:** run `/plan-eng-review` on the
  revised wedge architecture (D6 parallel boundary + D4 verification state
  machine are the two highest-risk architectural choices to lock in).
- **After Sprint 1 ships:** run `/qa` against the approval-queue UI; run
  `/design-review` for the mobile approval surface.

---

## 0. Context for Claude Code

You are extending **InvestorPilot** (`https://investor-pilot-pi.vercel.app/`) into a fully agentic outreach platform that replicates — and improves on — the manual methodology used by agencies like Affluent Connections (`https://affluentconnections.com`).

That methodology, confirmed by the agency directly, is:

1. Borrow the client's LinkedIn account ("borrowed authority")
2. Build a hyper-targeted prospect list of HNW individuals, family offices, and investors
3. Run multi-touch connection + DM sequences from the client's account
4. Layer in profile credibility (banner, headline, posts) before outreach
5. Hand-reply to inbound messages and book meetings into the client's calendar

InvestorPilot already covers steps 1, 2 (intelligence) and the first half of step 3 (drafting). The gap is **execution + conversation + booking + credibility scaffolding** as an agent stack.

You will NOT build any of this from scratch. The Corporate AI Solutions marketplace already contains the building blocks. Your job is **integration**, not greenfield development.

---

## 1. Inventory of Existing Assets (Reuse, Don't Rebuild)

Before writing code, you must read the current state of these repos/deployments and treat them as the source of truth:

| Asset | URL | Role in this build |
|---|---|---|
| **InvestorPilot** | `investor-pilot-pi.vercel.app` | Host application. AI Discovery, 5-Dim Scoring, Hunter enrichment, Draft Outreach, Evidence Trail, Approval Gates already exist. Extend here. |
| **OutreachReady** | `outreach-ready.vercel.app` | Multi-channel sending (LinkedIn, email, WhatsApp), voice-guided message crafting, strategic journey framework. **This is the sequencing + sending layer.** |
| **OMQ Outreach** | `omq-outreach.vercel.app` | Already runs a complete pipeline: Brave Search discovery → Claude scoring → Hunter.io enrichment → email + LinkedIn drafting → Resend sending → reply triage. **This is the reference implementation for the full pipeline.** Read its code first. |
| **PartnerPilot** | `partner-pilot.vercel.app` | Five-stage hybrid pipeline, email tracking, reply tracking. Sibling architecture to InvestorPilot. |
| **LeadSpark** | `leadspark-tenant.vercel.app` | Multi-tenant architecture, voice qualification, knowledge-base-aware responses, CRM routing. **Tenant/auth pattern to copy.** |
| **Platform Trust** | `platform-trust.vercel.app` | `@platform-trust/middleware` — install this. Audit logging, per-tenant token metering, human-in-the-loop gates, rate limiting. **Mandatory for compliance.** |
| **PubGuard** | `kira-rho.vercel.app/pubguard/scan` | Pre-deploy and weekly security scanning. Run before any production push. |
| **Connexions** | `connexions-silk.vercel.app` | Voice AI interviewer with theme/sentiment extraction. Useful for inbound reply classification training data. |
| **Kira** | `kira-rho.vercel.app` | Persistent voice-thinking-partner pattern. Reference for the "campaign strategist" voice agent. |
| **RaiseReady Template** | `raiseready-template.vercel.app` | White-label generator pattern. Once InvestorPilot is fully agentic, this becomes the template for vertical white-labels (Family Office edition, Property Dev edition, etc.). |
| **F2K Fund Tokenisation** | `f2-k-fund-tokenisation.vercel.app` | KYC + wholesale investor verification flow. Reuse for compliance-gated prospect qualification when the offering is regulated. |
| **DealFindrs** | `deal-findrs.vercel.app` | F2K-aligned property deal context. Use as the first vertical campaign test case. |
| **Property Services** | `property-services-kappa.vercel.app` | Shared data layer for property ventures. Use as enrichment source when targeting property investors. |
| **Storefront MCP** | `storefront-mcp-eight.vercel.app` | MCP server pattern. The agentic InvestorPilot itself should expose an MCP server so Claude Code / Easy Claude Code can drive campaigns externally. |
| **Easy Claude Code** | `easy-claude-code.vercel.app` | Mobile-triggerable workflows. Eventually, campaign approvals route here so the user approves replies from their phone. |

**Read order for Claude Code:** OMQ Outreach → OutreachReady → InvestorPilot → LeadSpark → Platform Trust → PartnerPilot. Build a dependency graph before touching code.

---

## 2. Target Architecture

Five agents, one orchestrator, one shared evidence store, one approval surface.

```
┌─────────────────────────────────────────────────────────────────┐
│                    InvestorPilot (Next.js, Vercel)               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Orchestrator (Inngest workflows)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│        │           │           │           │           │         │
│   ┌────▼───┐  ┌───▼────┐  ┌──▼─────┐  ┌──▼─────┐  ┌──▼─────┐   │
│   │Discovery│  │Identity│  │Sequence│  │ Inbox  │  │Calendar│   │
│   │  Agent  │  │ Agent  │  │ Agent  │  │ Agent  │  │ Agent  │   │
│   └────┬───┘  └───┬────┘  └──┬─────┘  └──┬─────┘  └──┬─────┘   │
│        │          │          │           │           │          │
│  ┌─────▼──────────▼──────────▼───────────▼───────────▼────┐    │
│  │     Evidence Store + State (Postgres / Supabase)        │    │
│  │     Audit Log (Platform Trust middleware)               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Channels: Unipile (LinkedIn + Email + Calendar)        │    │
│  │            Resend (transactional email)                 │    │
│  │            Hunter.io (already integrated)               │    │
│  │            Brave Search (already integrated via OMQ)    │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Agent responsibilities

| Agent | Owns | Reads | Writes |
|---|---|---|---|
| **Discovery** | Prospect generation + 5-dim scoring (already built) | Brave Search, Hunter, Apollo if added | `prospects`, `prospect_evidence` |
| **Identity** | OAuth + token management for client's LinkedIn/email/calendar | Unipile, Google OAuth, Microsoft Graph | `client_channels`, `channel_health` |
| **Sequencer** | Multi-touch journey state machine | `prospects`, `sequence_templates`, `client_channels` | `sequence_steps`, `outbound_messages` |
| **Inbox** | Reply classification + draft response generation | `inbound_messages`, evidence trail, client offering docs | `reply_classifications`, `draft_replies` |
| **Calendar** | Meeting proposal + booking | Calendar OAuth, `draft_replies` (when meeting intent detected) | `meetings`, `meeting_briefings` |

### Data model additions (minimum viable)

```sql
-- New tables (additive to existing InvestorPilot schema)

client_channels (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  channel_type text NOT NULL,  -- 'linkedin' | 'email' | 'calendar'
  provider text NOT NULL,      -- 'unipile' | 'google' | 'microsoft'
  account_identifier text,     -- email address or LinkedIn URN
  oauth_token_ref text,        -- pointer to secrets store, never the token itself
  daily_send_cap int DEFAULT 20,
  daily_send_count int DEFAULT 0,
  cap_reset_at timestamptz,
  status text DEFAULT 'active', -- 'active' | 'paused' | 'flagged' | 'revoked'
  created_at timestamptz DEFAULT now()
);

sequence_templates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  vertical text,               -- 'family_office' | 'wealth_manager' | 'hnw_individual' | 'property_investor'
  steps jsonb NOT NULL,        -- ordered array of {channel, delay_days, template_id, branch_logic}
  compliance_mode text DEFAULT 'standard'  -- 'standard' | 'finance_au' | 'wholesale_only'
);

sequence_steps (
  id uuid PRIMARY KEY,
  prospect_id uuid REFERENCES prospects(id),
  template_id uuid REFERENCES sequence_templates(id),
  step_index int NOT NULL,
  channel text NOT NULL,
  scheduled_for timestamptz,
  executed_at timestamptz,
  outbound_message_id uuid,
  status text DEFAULT 'pending', -- 'pending' | 'sent' | 'skipped' | 'failed' | 'replied' | 'opted_out'
  branch_taken text
);

outbound_messages (
  id uuid PRIMARY KEY,
  prospect_id uuid,
  channel text,
  channel_message_id text,     -- platform's ID (LinkedIn URN, email message-id)
  rendered_body text,
  evidence_refs jsonb,         -- which evidence pieces grounded this draft
  compliance_check jsonb,      -- flags raised by pre-send filter
  approved_by uuid,            -- user_id who approved, NULL if auto-approved
  approved_at timestamptz,
  sent_at timestamptz
);

inbound_messages (
  id uuid PRIMARY KEY,
  prospect_id uuid,
  channel text,
  channel_message_id text UNIQUE,
  received_at timestamptz,
  body text,
  classification jsonb,        -- {intent, sentiment, requires_human, suggested_branch}
  draft_reply_id uuid
);

draft_replies (
  id uuid PRIMARY KEY,
  inbound_message_id uuid,
  rendered_body text,
  evidence_refs jsonb,
  compliance_check jsonb,
  approval_state text DEFAULT 'pending',  -- 'pending' | 'approved' | 'edited' | 'rejected'
  approved_by uuid,
  sent_message_id uuid
);

meetings (
  id uuid PRIMARY KEY,
  prospect_id uuid,
  scheduled_for timestamptz,
  calendar_event_id text,
  conferencing_url text,
  briefing_doc jsonb,          -- auto-generated pre-meeting brief
  status text DEFAULT 'scheduled'
);

audit_events (  -- Platform Trust middleware writes here
  id uuid PRIMARY KEY,
  tenant_id uuid,
  actor text,                  -- 'agent:sequencer' | 'user:dennis' | etc.
  action text,
  resource_type text,
  resource_id uuid,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
```

---

## 3. The CHARM Methodology, Re-implemented Agentically

Affluent Connections calls their process CHARM. Mapped to your agents:

| CHARM stage | Agency does | Your agents do |
|---|---|---|
| **C**rafting a Flawless Impression | Manual LinkedIn profile rewrite, ghost-written posts | **Identity Agent** runs profile audit on connect, surfaces gaps, optionally generates posts via existing voice tooling. Profile remains human-approved. |
| **H**yper-Precise Prospect Targeting | Manual Sales Nav filtering | **Discovery Agent** (already built) — 5-8 categories, 5-dim scoring, evidence trail |
| **A**nchor Initial Engagement | Manual connection request + first DM | **Sequencer Agent** step 1: connection request from client's LinkedIn via Unipile, with personalised note grounded in evidence trail |
| **R**each Their Curiosity Naturally | Manual drip messages | **Sequencer Agent** steps 2–N: time-delayed follow-ups, branching on reply state |
| **M**obilize a Meeting | Manual CTA + Calendly | **Inbox Agent** detects meeting intent → **Calendar Agent** proposes slots from client's connected calendar → books and briefs |

The improvements over the agency model:
- **Every claim is grounded** in the evidence trail (already in InvestorPilot). Anti-hallucination rules already exist — extend them to the inbox replies.
- **Audit trail by default** via Platform Trust middleware.
- **Per-tenant compliance modes** — wholesale-only mode for Australian finance use cases locks down what messages can say.
- **Human-in-the-loop gates** at adjustable thresholds — high-stakes verticals (property dev raising from wholesale investors) gate every reply; low-stakes verticals (founder-to-VC intros) auto-send calendar coordination.

---

## 4. Execution Plan — Six Phases

Each phase ships independently and produces a usable increment. Do not start phase N+1 until phase N is in production with a real pilot user (F2K is phase 1's user).

### Phase 1: Identity Layer + Single-Send (2 weeks)

**Goal:** A client can connect their LinkedIn and email, and InvestorPilot can send a single approved message from their account.

**Tasks:**
1. Read OMQ Outreach repo. Document its Brave Search → Hunter → Resend flow in a `docs/reference-omq.md`.
2. Read OutreachReady repo. Document its multi-channel sending pattern in `docs/reference-outreachready.md`.
3. Add Unipile integration (`@unipile/node-sdk` or REST). Build `lib/channels/unipile.ts` with `connectLinkedIn()`, `connectEmail()`, `sendLinkedInDM()`, `sendLinkedInConnect()`, `sendEmail()`.
4. Add OAuth flows: `/api/auth/linkedin/connect`, `/api/auth/google/connect`, `/api/auth/microsoft/connect`. Store token refs (not tokens) per `client_channels`.
5. Install `@platform-trust/middleware`. Wrap all channel-sending endpoints with audit logging + rate limiting.
6. Extend the existing Draft Outreach UI to add a "Send via LinkedIn from my account" / "Send via my Gmail" button. Single send only, no sequencing yet.
7. Add daily-cap enforcement: max 20 LinkedIn connection requests, 30 DMs, 50 emails per channel per day. Enforce in middleware, surface in UI.
8. Pre-send compliance filter: regex + LLM check for prohibited phrases (returns %, guaranteed, risk-free, specific dollar amounts in cold outreach). Block + flag for review.
9. PubGuard scan before merge.

**Deliverable:** Dennis connects his LinkedIn + Gmail, picks a prospect from existing InvestorPilot discovery, approves a draft, and it sends from his account. End-to-end with audit log.

### Phase 2: Sequencer + State Machine (2 weeks)

**Goal:** Multi-touch sequences run automatically on a time delay, with per-step approval.

**Tasks:**
1. Add Inngest (Vercel-native). Define workflow `sequence.run` with steps for each sequence stage and `step.sleep` between them.
2. Build `sequence_templates` seed data for three verticals: `family_office_au`, `wholesale_property_investor`, `wealth_manager_us`. Three steps minimum each: connect → soft message → meeting CTA.
3. Build sequence-builder UI in InvestorPilot dashboard. Drag-and-drop steps, channel selection per step, delay configuration.
4. Implement branching: if reply received, pause sequence and hand off to Inbox Agent (built in phase 3); if connection declined, exit; if no response after N days, advance.
5. Add per-step approval gate. Default: every step requires approval. Add toggle for "auto-send after approval of template" once user trusts a sequence.
6. Add sequence dashboard: list of active prospects, current step, next scheduled action, status filter.
7. LinkedIn safety: stagger sends within working hours of the client's timezone, randomise delays ±30%, never burst-send.

**Deliverable:** A sequence runs end-to-end over 7 days against a 10-prospect test cohort with manual approvals at each step.

### Phase 3: Inbox Agent (3 weeks — the hardest phase)

**Goal:** When a prospect replies, the system classifies, drafts a response, and routes for approval.

**Tasks:**
1. Webhook ingestion: Unipile push for LinkedIn replies, Gmail push notifications via Pub/Sub for email. Land replies in `inbound_messages`.
2. Build the classification prompt. Output a structured JSON with: `intent` (interested | question | objection | soft_no | hard_no | out_of_office | referral | unsubscribe | spam), `sentiment` (positive | neutral | negative), `requires_human` (boolean), `suggested_branch`, `key_topics` (array). Use Claude Sonnet 4.6 via Anthropic SDK.
3. Wire the classifier into Inngest: on inbound message → classify → write classification → route.
4. Build the reply-drafter agent. Tool-calling pattern: tools are `read_evidence_for_prospect`, `read_offering_documents`, `read_calendar_availability`, `propose_meeting_slots`, `escalate_to_human`. Grounding is mandatory — agent must cite evidence refs in output.
5. Compliance lockdown: in `finance_au` mode, the drafter cannot send replies containing investment specifics without human approval. Hard rule, enforced by the same pre-send filter as outbound.
6. Inbox UI: unified inbox view across LinkedIn and email, classification badge per message, draft reply pre-populated, one-click approve / edit / reject / escalate.
7. Auto-approve rules engine: per-tenant config for which `intent` × `sentiment` combinations auto-send (default OFF for all). Start with "calendar coordination" only.

**Deliverable:** F2K runs a real campaign with the Inbox Agent. Replies are classified correctly ≥85% of the time. All replies still human-approved (auto-approve gated for later).

### Phase 4: Calendar Agent (1 week)

**Goal:** Detected meeting intent → proposed slots → booked meeting → briefing pack.

**Tasks:**
1. Reuse calendar OAuth from Phase 1. Add `getAvailableSlots(duration, window, working_hours)` to `lib/channels/calendar.ts`.
2. Calendar Agent triggered by Inbox Agent when classification intent ∈ {interested, meeting_request}. Proposes 3 slots in next 10 working days, respecting client's working hours.
3. On prospect confirmation reply, parse selection, create calendar event with conferencing (Google Meet or Zoom via API), send invites to both parties.
4. Auto-generate briefing pack: prospect's 5-dim scoring, evidence summary, full conversation transcript, suggested talking points. Drop into a per-meeting doc.
5. Briefing pack delivered to client's email 24h before meeting and 1h before meeting.

**Deliverable:** First fully agent-booked meeting, with auto-generated briefing pack reviewed and approved as accurate.

### Phase 5: Credibility Scaffolding (Optional, 2 weeks)

**Goal:** Improve outreach response rates by maintaining client's LinkedIn presence in parallel.

**Tasks:**
1. Profile Audit Agent: on LinkedIn connect, scan headline, About, banner, featured. Score against the vertical's "credible HNW-targeter" rubric. Surface gaps.
2. Optional rewrite suggestions via Claude, always human-approved before going live.
3. Post Generator: weekly cadence, topics drawn from client's evidence base (F2K projects, market insights, deal commentary). Draft → approve → schedule via Unipile.
4. Engagement bot: react to / comment on connected HNW prospects' posts (carefully, low volume, opt-in only). This is the riskiest feature — defer or skip if uncertain.

**Deliverable:** Profile uplift shown to lift response rate by N% on a controlled A/B over 30 days.

### Phase 6: Productisation as White-Label (2 weeks)

**Goal:** InvestorPilot becomes the next generator in the RaiseReady-style pattern.

**Tasks:**
1. Apply the RaiseReady Template pattern: `/setup?type=family_office` style configurator that spins up a branded InvestorPilot instance with vertical-specific sequence templates, evidence schemas, and compliance modes pre-loaded.
2. Vertical seeds: `family_office_au`, `wholesale_property_au` (F2K's case), `wealth_manager_us`, `vc_lp_outreach`, `private_bank_eu`, `nonprofit_major_donor`.
3. Expose an MCP server (pattern from Storefront MCP) so external agents can drive campaigns programmatically. Tools: `list_campaigns`, `create_campaign`, `approve_message`, `read_inbox`, etc.
4. Pricing model: revenue share or flat per-seat. List on the marketplace.

**Deliverable:** A second vertical (beyond F2K's wholesale property use case) is live with a different client.

---

## 5. Non-Negotiables (Read These Before Writing Code)

### 5.1 The client's LinkedIn account is the asset at risk

LinkedIn actively detects and bans automation. Mitigations are mandatory, not optional:

- Use Unipile or equivalent with residential IP rotation. **Never** call LinkedIn's private APIs directly from Vercel functions.
- Daily caps enforced server-side. UI cannot override.
- Human-like timing: randomised delays, working-hours only, no weekends by default.
- Warmup mode for newly-connected accounts: 5 actions/day for week 1, 10 for week 2, full caps from week 3.
- Health monitor: detect rate-limit responses, captchas, or login challenges from Unipile and auto-pause the account with a user alert.

If LinkedIn bans Dennis's account because the platform was reckless, the product is over. Build conservatively.

### 5.2 Compliance — especially for finance/property verticals

Australian wholesale-investor and AFSL rules constrain what unsolicited outreach can say:

- No specific return figures in cold outreach.
- No specific deal terms in cold outreach.
- Wholesale-investor declarations cannot be assumed — must be verified before any specifics shared.
- Anti-hawking provisions: be careful about offering specific financial products to retail consumers.

The `finance_au` compliance mode must enforce these in code. Pre-send filter on every outbound and every reply draft. Block + escalate, do not warn-and-allow.

Reuse the KYC + wholesale verification flow from F2K Fund Tokenisation for the qualification step before any specifics are sent.

### 5.3 Anti-hallucination is non-negotiable

InvestorPilot's existing rule — "every claim backed by evidence" — extends to:
- Every outbound message
- Every draft reply
- Every briefing pack

If the agent cannot ground a statement in the evidence store, it must not write it. Tool-calling pattern: the agent retrieves evidence first, then writes. Audit log captures evidence refs per message.

### 5.4 Approval-first, auto-second

Default every gate to "human approves." Add auto-approve only per-tenant, per-classification, per-channel, with clear UI. Log every auto-approved action with the rule that triggered it.

### 5.5 Platform Trust middleware is not optional

Every agent action, every channel send, every approval, every classification writes to `audit_events` via `@platform-trust/middleware`. This is the compliance backbone and the debug surface.

---

## 6. Reference Code Locations to Read First

Claude Code, before writing a single line, read these in order and write a `docs/architecture-notes.md` summarising what each one does and what's reusable:

1. **OMQ Outreach** (`omq-outreach.vercel.app`) — the closest-to-complete pipeline. Likely has working Brave + Hunter + Resend + classification logic. Mine for code.
2. **OutreachReady** (`outreach-ready.vercel.app`) — multi-channel sending, journey framework.
3. **InvestorPilot** (current code) — what's there, what's missing.
4. **PartnerPilot** (`partner-pilot.vercel.app`) — sibling architecture; similar pipeline.
5. **LeadSpark** (`leadspark-tenant.vercel.app`) — multi-tenant pattern, embeddable widget pattern.
6. **Platform Trust** middleware source — install, then read.

Repos that look similar (PartnerPilot, OMQ, InvestorPilot) likely share schemas and patterns — consolidate before extending. Don't create three copies of "prospect" types.

---

## 7. First Sprint Definition

**Sprint 1 (Week 1):**

- [ ] Read all listed reference platforms. Write `docs/architecture-notes.md`.
- [ ] Stand up Unipile dev account, get API keys, document onboarding flow.
- [ ] Add `client_channels` table to InvestorPilot's database (Supabase migration).
- [ ] Implement `/api/auth/linkedin/connect` and `/api/auth/google/connect` OAuth flows via Unipile.
- [ ] Implement `lib/channels/unipile.ts` with `sendLinkedInDM`, `sendLinkedInConnect`, `sendEmail`.
- [ ] Install `@platform-trust/middleware`. Wrap channel-sending endpoints.
- [ ] Add "Send from my account" button to existing Draft Outreach UI (single message, no sequencing).
- [ ] Enforce daily caps server-side.
- [ ] Pre-send compliance filter (regex baseline; LLM check follows).
- [ ] PubGuard scan green before merge.
- [ ] Dennis tests by sending himself a LinkedIn DM via the app from his own account.

**Sprint 1 exit criteria:** Dennis connects LinkedIn + Gmail in the InvestorPilot UI, picks an existing scored prospect, and sends a single agent-drafted, human-approved message that lands in the recipient's LinkedIn inbox or Gmail. Audit log captures the full action. No sequencing yet.

---

## 8. Open Questions for the Operator (Dennis)

Resolve before Sprint 2:

1. **Pilot user for Phase 1:** Confirm F2K (Uwe + Dennis) is the pilot. Confirm the campaign target — Australian wholesale property investors? SMSF trustees? Family offices?
2. **Compliance posture:** Engage AFSL/legal review of the `finance_au` compliance mode rules before any real wholesale-investor outreach. Document the rules in `docs/compliance-finance-au.md`.
3. **Unipile vs alternatives:** Unipile assumed in this plan. Confirm or substitute (HeyReach + Nylas combo is the main alternative).
4. **Channel priority:** LinkedIn-first (agency model) or email-first (deliverability moat)? Affects Sprint 1 scope.
5. **Auto-approve threshold:** Where on the trust curve does Dennis want to land? Recommend starting fully manual for first 30 days.
6. **Brand:** Does the agentic InvestorPilot keep that name, or rebrand to something that signals "agent" more clearly (e.g., AffluentAgent, ProspectPilot Auto)?

---

## 9. Success Metrics

Track from day 1, even at pilot scale:

- **Per-channel deliverability**: connection accept rate, email open rate, email reply rate, LinkedIn DM reply rate.
- **Funnel rates**: prospect → contacted → engaged → meeting booked → meeting held → opportunity created.
- **Agent quality**: classification accuracy (vs human label sample), draft reply acceptance rate, hallucination flags per 1000 messages.
- **Account health**: LinkedIn rate-limit events, email bounce rate, spam complaint rate, account warnings.
- **Compliance**: pre-send filter trigger rate, manual escalation rate, audit log completeness.

Target benchmarks based on agency norms:
- LinkedIn connect acceptance: 25–40%
- LinkedIn DM reply rate: 5–15%
- Email reply rate: 2–8%
- Meeting booking rate: 1–3% of total outreach
- If you beat agency norms by 25%+ with full evidence grounding and compliance, the product is defensible.

---

## 10. What This Becomes

When all six phases are done, InvestorPilot is no longer "AI-powered investor discovery." It is **the agentic replacement for the entire Affluent Connections value chain**, with three structural advantages:

1. **Evidence-grounded, audit-logged** — defensible for finance and regulated verticals where agencies are not.
2. **White-labelled per vertical** via the RaiseReady-style generator — each vertical is a separately-brandable product.
3. **MCP-exposed** — external agents (Claude Code, Easy Claude Code, partner tools) can drive campaigns programmatically. The platform becomes infrastructure, not a SaaS.

F2K is the wedge customer. The category is "agentic capital-raising and HNW prospecting." The moat is the combination of evidence-grounding + compliance modes + multi-channel orchestration + the white-label generator — none of which manual agencies can build, and none of which generic outreach tools (Smartlead, Instantly, Lemlist) have.

---

*End of plan. Claude Code: begin with Section 6 reading, then Section 7 Sprint 1. Update this document with discovered constraints as you go.*

**SUPERSEDED:** The "POST-CEO-REVIEW REVISIONS" section at the top of this file
takes precedence over the Claude Code reading order above. Begin with Sprint 0
(post-review revised section), not Section 6 reading.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | Objective re-anchored; 6 decisions captured (D1-D6); 4 critical pre-send gates surfaced; 8 items deferred to NOT-in-scope |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | Recommended after Sprint 0 produces validated inputs |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Approval queue is critical UX surface; mobile-first |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0 — all decisions D1-D7 answered
- **CRITICAL GAPS:** 4 — AFSL/legal sign-off (BLOCKS Sprint 1), kill switch (Sprint 1 deliverable), RLS pre-migration review (Sprint 1 deliverable), ICP validation with Uwe (BLOCKS Sprint 1 sends)
- **VERDICT:** CEO review complete on placeholder ICP — re-run with validated ICP after Sprint 0; eng review required before any code lands

