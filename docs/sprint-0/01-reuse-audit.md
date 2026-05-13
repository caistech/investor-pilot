# Sprint 0 — Reuse Audit (Local Sibling Repos)

**Date:** 2026-05-12
**Author:** Claude (CEO review session)
**Status:** Complete
**Method:** Direct code audit of local repos via subagent exploration

---

## TL;DR

The original agentic plan's reuse claims are **partially correct and partially aspirational**. Three of the four sibling repos audited (OMQ, OutreachReady, F2K-Fund-Tokenisation) had at least one overstated claim. The audit produces concrete code-extraction targets and explicit "build from scratch" items the plan implied were free.

### Claim-vs-Reality Summary

| Plan claim | Reality | Impact |
|---|---|---|
| "OMQ Outreach: closest-to-complete pipeline" | Service wrappers (Brave/Hunter/Resend) clean and reusable; pipeline routes copyable; **no sequence automation; partner schema is B2B procurement**, not investor-shaped | ~40% reuse leverage on core pipeline; ~18h adaptation work, not "5-10h copy and go" |
| "OutreachReady: multi-channel sending layer" | **Completely overstated.** Channels are an enum string. NO LinkedIn/email/WhatsApp send implementation. Only message-generation + manual-approval UX. | Cannot reuse for sending. Limited prompt/UX reference only. **Must build channels from scratch.** |
| "PartnerPilot: sibling architecture, reply tracking" | Identical to InvestorPilot pre-Resend; no meaningful divergence | No port-back value. PartnerPilot will eventually want to port FROM InvestorPilot. |
| "Reuse KYC + wholesale verification from F2K Fund Tokenisation" | KYC plumbing via Sumsub exists (identity + address only). **NO wholesale-investor verification logic** — `investor_type` is self-declared, not validated. | **Major hidden scope:** InvestorPilot must build AFSL lookup + sophistication check from scratch. ~3-5 days of work the plan didn't surface. |

---

## OMQ Outreach — The Gold Mine for Service Wrappers

Location: `C:\Users\denni\PycharmProjects\omq-outreach\`

### Copy verbatim (~0 hours adaptation)

| File | LOC | Purpose |
|---|---|---|
| `src/lib/agent/brave-tools.ts` | ~72 | Brave Search wrapper, zero DB coupling |
| `src/lib/agent/hunter-tools.ts` | ~118 | Hunter.io email finder, domain search, verifier |
| `src/lib/email/resend.ts` | ~51 | Resend sendEmail() — pure function |
| `src/lib/agent/linkedin-discovery.ts` | ~139 | Brave + Claude LinkedIn URL discovery, confidence-scored |

**Action:** Compare against InvestorPilot's existing equivalents (it already has `brave-tools.ts`, `hunter-tools.ts`, `email/resend.ts`). Diff for any improvements OMQ has that InvestorPilot lacks. Adopt `linkedin-discovery.ts` if InvestorPilot does not have its own — this is the way to populate LinkedIn URLs for ICP prospects without Unipile.

### Copy + adapt (1-4 hours each)

| Component | Adaptation needed |
|---|---|
| Pipeline routes (`/api/pipeline/{discover,enrich,draft,send,track}`) | Already adapted in InvestorPilot. Cross-check for any improvements. |
| Reply classifier (`src/app/api/triage/classify/route.ts`, ~173 LOC) | **Adopt as foundation for future Inbox Agent.** Adapt classification prompt for investor reply context (intents: interested / questions / objection / OOO / decline / spam). |
| Auth + RLS middleware (~150 LOC) | Already present in InvestorPilot via Supabase SSR. Cross-check RLS policies match. |

### Do not reuse / build from scratch

| Component | Why |
|---|---|
| Partner scoring rubric (B2B procurement: tier1_developer, btr_operator, etc.) | Wrong domain. Use InvestorPilot's re-weighted 5-dim investor scoring (D5). |
| `eoi_submissions` / `cohort_members` tables | OMQ-specific bespoke domain. |
| Sequence automation | **Not implemented in OMQ.** This must be built fresh in InvestorPilot Phase 2. |
| Bounce webhook | Not implemented. Build per InvestorPilot's CLAUDE.md webhook conventions (Svix signature validation, `/api/webhooks/resend`). |

### Concrete extraction effort

| Item | Effort (CC-assisted) |
|---|---|
| Diff OMQ wrappers vs InvestorPilot equivalents, adopt improvements | 1h |
| Adopt `linkedin-discovery.ts` (if not present) | 30min |
| Adapt reply classifier for Phase 3 (defer until Phase 2 ships) | — deferred |
| **Total Phase 1 extraction effort:** | **~1.5 hours** |

---

## OutreachReady — Misnamed; Limited Reuse

Location: `C:\Users\denni\PycharmProjects\OutreachReady\`

### What it actually is

A **voice-guided message draft tool** with manual copy-paste workflow. Not a "sending layer."

- Stores LinkedIn URL but does NOT send via LinkedIn (Unipile is absent)
- Email is a channel enum but has NO provider integration
- WhatsApp is in a dropdown only
- "Journeys" are static step lists with `completed` boolean; no automation, no scheduler, no branching

### Reusable

| Component | Effort to reuse |
|---|---|
| Approval UX pattern (`app/(dashboard)/contacts/[id]/messages/page.tsx`, ~273 LOC) — select variant → copy → mark sent | 2-3h to refactor into reusable component with real send buttons |
| Message generator prompt structure (`lib/ai/message-generator.ts`) — 4-variant generation (direct / value / curiosity / relationship) | 1h to adapt for investor context |
| `fetchWebsiteContent()` utility (web-scrape helper) | 30min |

### Not reusable

- **Channel sending infrastructure (does not exist).** Build LinkedIn from scratch via Unipile; email already via Resend.
- Sequence automation (does not exist).
- Compliance filtering (does not exist).
- Multi-tenant model (single-tenant only).

### Honest take

The plan's reading order ("OMQ → OutreachReady → InvestorPilot") gave OutreachReady disproportionate billing. Reorder reading to: **OMQ first** (for service wrappers and reply classifier) → InvestorPilot current state → OutreachReady (UX pattern only).

---

## PartnerPilot — No Reuse Value Forward

Location: `C:\Users\denni\PycharmProjects\PartnerPilot\`

### Findings

- **Identical schema** to InvestorPilot. Identical RLS policies. Identical migrations.
- **Identical pipeline routes** (discover/enrich/draft/send/track) — but PartnerPilot's `send` route creates Gmail drafts only; does NOT actually transmit. InvestorPilot's `send` route added Resend transmission (commit 2883562).
- **No LinkedIn integration** in PartnerPilot.
- **No reply classifier** in PartnerPilot.
- 4 commits behind InvestorPilot.

### Recommendation

**Do nothing with PartnerPilot for InvestorPilot's purposes.** If you intend to keep PartnerPilot maintained as a B2B-partnership variant, port the Resend integration FROM InvestorPilot when the agentic stack stabilizes.

---

## F2K-Fund-Tokenisation — Major Hidden Scope Issue

Location: `C:\Users\denni\PycharmProjects\F2K-Fund-Tokenisation\`

### What exists

- **KYC via Sumsub (third-party):** `/apps/investor-portal/src/app/api/kyc/{token,webhook,override}/route.ts`
  - Identity verification (passport/driver's licence) + address proof
  - Webhook updates `investors.kyc_status` (approved / rejected / pending / expired)
  - Admin manual override with audit trail
- **Investor declaration form:** `apps/investor-portal/src/app/(portal)/onboarding/page.tsx`
  - Self-declared: net assets >$2.5M OR income >$250K (s708 sophisticated investor test)
  - User picks `investor_type` field manually
  - **No validation, no AFSL check, no audit beyond self-declaration**
- Schema: `investors.kyc_status`, `investors.investor_type`, `investors.kyc_provider_id`, `investors.kyc_completed_at`

### What does NOT exist

- **AFSL license validation** (ASIC register lookup)
- **Advisor sophistication check** (validates that an *advisor*'s client base qualifies as wholesale — different from validating the advisor themselves)
- **Audit trail of wholesale status over time**
- **Programmatic verification of s708(8) eligibility** (the law's specific test for sophisticated investors)

### What this means for InvestorPilot's D4 decision

D4 specifies "pre-meeting code-enforced verification." The plan implied this would be a 1-2 day reuse of F2K's flow. **The audit shows F2K does not have what we need.** InvestorPilot needs to build:

1. **AFSL verification step** — query ASIC's AFSL register API (or scrape if no API) to confirm the prospect's firm holds a current AFSL.
2. **Advisor sophistication declaration** — a form/flow where the advisor confirms their client base is composed of sophisticated/wholesale investors per s708(8), with audit trail.
3. **(Optional, later phase) Verification of specific clients** — if F2K wants to verify the END investor that the advisor introduces, that's the existing F2K Sumsub flow, but that's downstream of "the advisor meets with us."

### Effort estimate (new, not in original plan)

| Item | Effort (CC-assisted) |
|---|---|
| AFSL register integration (ASIC API research + lookup wrapper + caching) | 4-6h |
| Advisor sophistication declaration form + DB schema | 2-3h |
| Integration into sequence state machine (verification = required state before meeting-stage advance) | 3-4h |
| RLS + audit logging | 2h |
| **Total new effort:** | **11-15 hours** |

**This is ~2 days of work not surfaced in the original plan.** Update Sprint 0 / Sprint 1 estimates accordingly.

---

## Consolidated Reuse Roadmap (Phase 1-2)

### Phase 1 (single-send + approval queue)

| Source | What to bring across | Effort |
|---|---|---|
| OMQ | Diff service wrappers, adopt improvements | 1h |
| OMQ | `linkedin-discovery.ts` (if absent in InvestorPilot) | 30min |
| OutreachReady | Approval UX pattern (refactor with real send) | 2-3h |
| F2K-FT | Sumsub integration pattern (reference only) | — |
| **Build new** | AFSL register lookup | 4-6h |
| **Build new** | Advisor sophistication declaration | 2-3h |
| **Build new** | Unipile LinkedIn wrapper | 4-6h |
| **Build new** | Pre-send compliance filter (regex + LLM) | 3-4h |
| **Build new** | Kill switch + middleware enforcement | 2h |
| **Build new** | Mobile-friendly approval UI | 4-6h |
| **Total Phase 1:** | | **~24-32 hours CC-assisted** |

### Phase 2 (sequencer + verification gate)

| Source | What to bring across | Effort |
|---|---|---|
| OMQ | Reply classifier (foundation for Phase 3, optional in Phase 2 if Inbox Agent is deferred) | 2h |
| **Build new** | Sequence state machine (DB + scheduler) | 6-8h |
| **Build new** | Sequence template DSL + UI | 4-6h |
| **Build new** | Verification gate as required sequence state | 3-4h |
| **Build new** | Headline meetings/week dashboard | 4-6h |
| **Total Phase 2:** | | **~19-26 hours CC-assisted** |

---

## Recommendations

1. **Update INVESTOR_PILOT_AGENTIC_PLAN.md "What already exists" section** to reflect the audit's reality. The original reuse table overstates leverage from OMQ and OutreachReady by ~2x and entirely misrepresents F2K-Fund-Tokenisation as already-built.

2. **Add ~13 hours of new scope to Sprint 1 estimate** for AFSL verification and advisor sophistication declaration. These are *gating* for D4 (pre-meeting code-enforced verification) and were assumed-free in the original plan.

3. **Reading order revision:** OMQ first (highest reuse), then InvestorPilot current state, then OutreachReady (UX pattern only). Drop PartnerPilot from reading list — no value forward.

4. **Cross-reference OMQ's webhook handling pattern (`/api/webhooks/eoi/`) when implementing the Resend webhook** for bounce/complaint handling. The Svix signature validation is identical to what InvestorPilot's CLAUDE.md requires.

5. **Defer the reply classifier port from OMQ until Phase 2 ships.** It's foundational for Phase 3 Inbox Agent but adds no Phase 1 value. Start collecting labelled reply examples in Phase 1 for eventual eval set.

---

## Open Questions (for D Phase or Uwe)

1. Does F2K already have an ASIC API integration or a chosen AFSL-lookup vendor? (Avoids re-research.)
2. Will F2K accept a self-declaration-with-audit model for advisor sophistication, or does compliance counsel want a stricter check?
3. Should the sophistication declaration block message sending entirely, or only block meeting confirmation? (D4 says pre-meeting; some advisors may prefer a soft path that lets discovery message land before they declare.)
