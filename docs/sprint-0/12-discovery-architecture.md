# Sprint 0 — Discovery Architecture (v3)

**Date:** 2026-05-13
**Status:** Live — captures the now-understood scope after the LinkedIn-as-primary-engine clarification.
**Owner:** Dennis McMahon
**Supersedes:** any earlier framing that treated LinkedIn search as a "Sprint 2 add-on" — it isn't, it's the core of the methodology.

---

## TL;DR

**LinkedIn search via the operator's connected account is the PRIMARY discovery engine.** Brave web search is a supplement. This mirrors the Affluent Connections methodology, which is what InvestorPilot is replicating with automation:

> Find prospects on LinkedIn / Sales Navigator → ask for a connection from the operator's account → send a DM intro after acceptance → continue the credit conversation. Email is a parallel channel where Hunter surfaces a verified work address.

---

## The three sources

| Source | Role | What it returns | Per-hit data attached |
|---|---|---|---|
| **LinkedIn people search** | **Primary** | Individual people who match the query in the operator's network neighbourhood | `full_name`, `headline`, `current_company`, `profile_url`, `location`, `industry` |
| **Sales Navigator search** | Primary (if subscribed) | Same as LinkedIn but with richer filters (seniority, function, years in role, premium intent signals) | Same as above + filter-derived metadata |
| **Brave web search** | Supplement | Company sites, news, press, fund reports — anything indexable that signals lender behaviour but isn't a profile | Company name, domain, page snippet |

All three feed the same scoring step (v3 SCORING_PROMPT in `src/app/api/pipeline/discover/route.ts`). Output: a `partners` row with weighted score, scoring notes, and — for LinkedIn-sourced hits — pre-populated `contact_name`, `contact_title`, `contact_linkedin`.

---

## Why LinkedIn is the primary engine, not Brave

| Lever | Brave web search | LinkedIn people search |
|---|---|---|
| **Targeting** | Pages, news, sites — noisy | People directly, filterable by title/industry/location/seniority |
| **Contact data per hit** | None (need Hunter enrich step) | `contact_linkedin` URL attached natively |
| **Cheque-size / authority signal** | Has to be inferred from page text | Job title + tenure visible immediately |
| **Family office / private credit principals** | Often invisible on the public web | Almost all on LinkedIn |
| **Cost per query** | Effectively free (Brave free tier) | Consumes one of the operator's LinkedIn search calls (capped by LinkedIn, not by us) |
| **Per the v3 ICP — FO CIOs, FO principals, HNW direct lenders** | Weak source | Strong source |

For lender outreach the answer is unambiguous: LinkedIn first, Brave when the profile isn't enough (e.g. you want news of a recent deal participation, or a public fund report that names lenders).

---

## End-to-end pipeline (current state)

```
1. Operator (Dennis) connects LinkedIn account
   → /channels page → Unipile-hosted OAuth
   → client_channels row with oauth_token_ref (Unipile account id)

2. Operator defines product + ICP
   → /products page → Auto-Fill from URL / PDF / text
   → products row with name, one_sentence_description, ICP fields
   → product_sources rows (PDFs, URLs) for knowledge base

3. Operator runs Discover
   → /discover page → picks sources (default: LinkedIn if connected)
   → POST /api/pipeline/discover with { sources: [...], query, linkedin_filters? }
   → For each source:
       linkedin     → searchLinkedInPeople via Unipile (operator's account)
       sales_nav    → searchSalesNavigator via Unipile (needs subscription)
       brave        → braveWebSearch (operator's BRAVE_API_KEY)
   → De-dupe by linkedin URL || domain
   → Each candidate scored by Claude one-shot against v3 SCORING_PROMPT
   → Upsert into partners
       LinkedIn-sourced hits land as status='contact_found' (LinkedIn URL pre-attached)
       Brave-sourced hits land as status='scored' (need enrich for contact)

4. Operator enriches if needed
   → /partners → Enrich → Hunter.io for email + LinkedIn URL where missing
   → Only Brave-sourced hits typically need this; LinkedIn hits skip ahead

5. Operator assigns to sequence
   → /partners/[id] → Assign sequence sidebar
   → POST /api/sequences/assign → materialises sequence_steps rows

6. Sequencer cron renders + queues for approval (every 15 min)
   → POST /api/cron/sequencer
   → Renders templates with {first_name}, {firm}, {credit_signal} via Claude
   → Compliance check (regex) against forbidden phrases
   → Step → queued_for_approval (or compliance_blocked)

7. Operator approves at /approvals
   → POST /api/approvals/[id]/approve
   → Channel-guard check (kill switch, daily cap, warmup)
   → Dispatch:
       linkedin_connect → Unipile sendLinkedInConnect from operator's account
       linkedin_dm      → Unipile sendLinkedInDm from operator's account
       email            → Resend sendEmail (Sprint 1) or Unipile email (later)
   → Re-anchor future steps to actual send time

8. Replies arrive at the operator's connected account
   → Unipile webhook → /api/webhooks/unipile/account
   → inbound_messages row + partner status → 'replied'
```

This is **the Affluent Connections methodology, automated end-to-end**, with the operator's own LinkedIn account as the sending and searching identity throughout.

---

## What's in code today

| Layer | Status |
|---|---|
| Unipile send (connect, DM, email) | ✅ Wired |
| Unipile LinkedIn people search | ✅ Wired — `searchLinkedInPeople` in `src/lib/channels/unipile.ts` (endpoint shape pending spike validation, doc 08 test 3.11) |
| Unipile Sales Navigator search | ✅ Wired — `searchSalesNavigator`, ditto |
| Brave web search | ✅ Wired pre-v3 |
| Multi-source discover route | ✅ Wired — `/api/pipeline/discover` accepts `sources: ('linkedin' \| 'sales_nav' \| 'brave')[]` |
| Source picker UI | ✅ Wired — `/discover` page defaults to LinkedIn if channel connected |
| Sequencer cron | ✅ Wired |
| Approval queue | ✅ Wired |
| Channel-guard (daily cap, warmup, kill switch) | ✅ Wired |
| Pre-send compliance filter | ✅ Wired (regex; LLM pass is a stub) |
| Re-anchor next step on send | ✅ Wired |

---

## What's not yet validated

- **Unipile search endpoint shapes** — the wrappers are written speculatively per Unipile's published docs. The spike (doc 08, new tests 3.11-3.13) confirms the exact request/response shape. Adjust the `parseLinkedInSearchResponse` normaliser if the field names differ.
- **Search rate-limit behaviour** — LinkedIn has a soft daily search cap that varies by account tier. Channel-guard does not currently rate-limit search. Spike test 3.13 documents observed cap behaviour; we add gating after the data is in.
- **Sales Navigator availability** — code path is present but only useful if the operator's connected account has an active SN subscription.
- **AFSL / wholesale-borrower solicitation framing** — counsel sign-off pending per v3 brief Section 5.8. Until signed off, only run the pipeline in test mode.

---

## How this maps to Affluent Connections

| AC manual step | InvestorPilot automated step |
|---|---|
| Define ICP (target profile, industry, location, seniority) | Product + ICP fields + LinkedIn search filters |
| Find prospects on Sales Navigator / LinkedIn | `/discover` with source=linkedin/sales_nav |
| Vet each prospect manually | v3 SCORING_PROMPT (Claude one-shot per candidate) |
| Send personalised connection request from client account | `linkedin_connect` step in lender v3 sequence (sent via Unipile from client's account) |
| Wait for accept | Day 2 step scheduled, re-anchored when accept webhook arrives (Phase 3) |
| Send first DM after accept | `linkedin_dm_first` step |
| Email touchpoint with personalised credit signal | `email_first` step in parallel |
| Follow-up DM if no reply | `linkedin_dm_fu` step |
| Final email | `email_fu2` step |
| Inbox triage and reply handling | Phase 3 (Inbox Agent + reply classifier) |
| Calendar booking after engagement | Phase 4 (Calendar Agent via Unipile calendar OAuth) |

**Phase 1-2 = the cold-outreach engine** (everything in the table above except inbox triage and calendar). **Phase 3-4 = the warm-conversation handoff.** What we've shipped covers Phase 1-2 except for the accept-webhook-driven step re-anchoring, which becomes useful once the first real cohort runs.

---

## References

- `06-draft-linkedin-message.md` — v3 LinkedIn message templates
- `07-draft-email-message.md` — v3 email message templates
- `08-unipile-spike-spec.md` — Unipile validation tests (tests 3.11-3.13 added for search)
- `09-f2k-best-fit-profile-DRAFT.md` — Lender ICP definition + scoring weights
- `11-senior-debt-brief-v3.pdf` — Uwe-signed source of truth
- `INVESTOR_PILOT_AGENTIC_PLAN.md` — Top-level plan
- `src/lib/channels/unipile.ts` — Unipile wrapper (send + search)
- `src/app/api/pipeline/discover/route.ts` — Multi-source discover route
- `src/lib/sequencer/render.ts` — Per-step message renderer
- `src/app/api/cron/sequencer/route.ts` — Cron worker
- `src/app/api/approvals/[id]/approve/route.ts` — Inline send + re-anchor
