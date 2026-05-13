# Sprint 0 — Pre-Implementation Validation Pack (v3)

**Date:** 2026-05-13
**Status:** v3 — re-scoped to senior debt focus per Senior Debt Brief v3 (signed off by Uwe)
**Owner:** Dennis McMahon

---

## v3 reframing — read first

Per Senior Debt Brief v3 (`11-senior-debt-brief-v3.pdf`):

**InvestorPilot's outreach channel now targets direct lenders + family office private debt allocators**, not financial advisors. The previous advisor-channel framing (v1/v2/v2.1) is superseded. The $125K wholesale-investor layer is sourced via Uwe's own network and is out of scope for InvestorPilot's automated outreach.

The Stamford / Front Financial broker process for placing the combined $18.7M senior facility has stalled. InvestorPilot is now the **parallel direct-to-lender process**.

This v3 README reflects which documents in this folder are operationally live vs superseded.

---

## What's in this folder

| # | File | Version | Status | Purpose |
|---|---|---|---|---|
| 00 | `00-README.md` | v3 | Live | This file — orchestration |
| 01 | `01-reuse-audit.md` | v1 | **Live** | Sibling repo audit (OMQ, OutreachReady, PartnerPilot, F2K-FT). Audience-agnostic. |
| 02 | `02-funnel-math.md` | **v3** | **Live** | Lender-channel funnel; $18.7M syndicate-fill objective. Replaces v1 advisor funnel. |
| 03 | `03-unipile-research.md` | v1 | **Live** | Unipile capability + alternatives. Audience-agnostic. |
| 04 | `04-icp-brief-template.md` | v1 | **SUPERSEDED** | Advisor ICP template. Banner added. Use file 09 v3 + Senior Debt Brief Section 4 instead. |
| 05 | `05-f2k-offering-brief-template.md` | v1 | **SUPERSEDED** | Advisor-channel offering brief. Banner added. Use Senior Debt Brief Sec 2-3 instead. |
| 06 | `06-draft-linkedin-message.md` | **v3** | **Live** | Lender-channel LinkedIn templates (credit conversation). |
| 07 | `07-draft-email-message.md` | **v3** | **Live** | Lender-channel email templates (credit conversation). |
| 08 | `08-unipile-spike-spec.md` | v1 | **Live** | Unipile capability spike Dennis runs. Audience-agnostic. |
| 09 | `09-f2k-best-fit-profile-DRAFT.md` | **v3** | **Live** | Operational mirror of Senior Debt Brief; defines tracks, ICP, scoring weights. |
| 10 | `10-spv-term-sheets.md` | v2 | **Mixed** | Senior debt sections live; investor channel sections marked out of scope. |
| 11 | `11-senior-debt-brief-v3.pdf` | v3 | **SIGNED-OFF** | Source of truth. Uwe-signed. |

---

## v3 cascade summary

What changed when Uwe signed off the Senior Debt Brief v3:

| Element | v2.1 (advisor) | v3 (lender) |
|---|---|---|
| **Audience** | Financial advisors placing wholesale clients | **Direct lenders + FO private debt allocators** |
| **Per-touch value** | $125K ticket | **$1M-$5M ticket** |
| **Channel objective** | 5 meetings/week | **Fill $18.7M syndicate in 12-16 weeks** |
| **Decision conversation** | Product-suitability | **Credit conversation (LVR, security, term)** |
| **Geographic priority** | TAS + WA for project locality | **Sydney + Melbourne + Singapore** for FO concentration |
| **Scoring weights** | Client Quality 30 / Alt-History 25 / Reach 20 / Reg 15 / Geo 5 | **Capital 25 / Asset-Class 25 / Track-Record 25 / Authority 15 / Reachability 10** |
| **Verification gate** | Advisor sophistication declaration | **Lender legitimacy (allocation authority)** |

---

## Pending Uwe decisions (Section 5 of brief)

| # | Decision | Affects |
|---|---|---|
| 5.1 | Quoted rate floor (8.5% / 8.0%) — hold or negotiate? | Pre-send compliance filter rules |
| 5.2 | Lead arranger sought or F2K-coordinated? | Message angle |
| 5.3 | Combined vs per-project messaging — recommend Option 4 (tailor to lender size) | Sequencer routing logic |
| 5.4 | Sponsor capability statement content | Follow-up attachment |
| 5.5 | Stamford/Front response — soft cold, direct in conversation | Inbox Agent script |
| 5.6 | Junior layer disclosure — include in second-touch | Sequence step 2 template |
| 5.7 | Tokenised fund response | Inbox Agent script |
| 5.8 | AFSL / regulatory framing — counsel-confirmed | Pre-send filter + send gate |

---

## What's done (AI side) vs pending (humans)

### Done in this Sprint 0 session
- All Sprint 0 docs reframed to v3 lender channel
- Senior Debt Brief PDF saved as file 11
- Funnel math reset
- Message templates rewritten for credit conversation
- ICP scoring re-weighted
- File 10 marked investor channel out of scope
- `INVESTOR_PILOT_AGENTIC_PLAN.md` updated

### Pending Uwe / counsel
- Section 5 decisions (8 items)
- Counsel sign-off on message templates against AFSL / wholesale-borrower-solicitation framing

### Pending Dennis
- Unipile 4-hour spike (doc 08)
- Confirm Sec 5.5 / 5.6 / 5.7 response scripts in writing

### Audience-agnostic build (parallel to Uwe sign-off)
- Unipile wrapper library
- OAuth flows for LinkedIn / Gmail / Outlook
- Channel-guard middleware (daily caps + warmup + kill switch)
- Pre-send compliance filter framework
- Approval queue UI shell
- Database migration for client_channels + sequence tables + audit log
- Platform Trust middleware install

---

## Gate criteria — what must be true before Sprint 1 code goes live to real lenders

1. **Senior Debt Brief v3 Section 5** decisions all signed off by Uwe
2. **AFSL counsel** has reviewed and approved message templates + cold-outreach approach for senior debt solicitation
3. **Unipile spike** = COMMIT verdict (per doc 08)
4. **Lender ICP** loaded into discovery prompt
5. **Scoring rubric weights** updated in code
6. **Message templates** loaded into draft prompt
7. **Compliance filter rules** loaded from JSON config
8. **Kill switch** tested
9. **Audit-agnostic infrastructure** (Unipile wrapper, OAuth, middleware) compiled and deployed
10. **Test cohort of 10 real lenders** run as Sprint 1 exit criteria

---

## Recommended workflow

1. **In parallel now:**
   - Uwe marks up Section 5 of brief v3 + signs off
   - Counsel reviews message templates + AFSL position
   - Dennis runs Unipile spike
   - Audience-agnostic infrastructure built and compiled

2. **When Uwe + counsel sign off:**
   - Compliance filter rules loaded
   - Sprint 1 messages can ship to first 10 lender cohort

3. **After Sprint 1 exit criteria:**
   - Run `/plan-eng-review` on the wedge architecture (lender-specific verification gate, etc.)
   - Phase 2 sequencer build

---

## Sources

- `11-senior-debt-brief-v3.pdf` — Uwe-signed (May 2026)
- `Branscombe Finance Submission V10`, `Seafields Finance Brief V10`, `F2K_FrontFinancial_StamfordCapital_V10` — facility specifics
- `factory2key.com.au` (May 2026) — operational arm
