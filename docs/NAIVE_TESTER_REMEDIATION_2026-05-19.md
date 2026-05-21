# InvestorPilot — Naive Tester Remediation Plan (2026-05-19)

**Status:** PLAN ONLY — awaiting Dennis approval before execution.
**Source report:** `C:\Users\denni\naive-tester-reports\2026-05-19-1711\investor-pilot.md`
**Persona:** Liam, BDR Manager, boutique funds management (wholesale-investor outreach)
**Risk tier:** REVENUE (per `CLAUDE.md`)

---

## Executive summary

Liam was largely positive. He called the auth page the best in the portfolio,
called the `finance_au_senior_debt` ruleset a real differentiator, and named the
two-modes-one-workflow framing as a credible wedge against Apollo + Lemlist.
**The single buying blocker was the `/pricing` page reading "Coming soon" with
an open-text suggestion form and no anchor number.** That is the only finding
graded as a remediation action. Everything else in this plan is either a
confirmed strength to preserve or a small copy/trust tweak that lifts the
sale-closing surfaces without rebuilding them.

This plan is intentionally short. The product is in good shape from the
operator's POV. The job is to put a number on the pricing page and surface
two compliance trust signals that are already true but currently buried.

---

## Findings inventory

### Confirmed strengths — keep (no action)

| # | Finding | Evidence in repo |
|---|---|---|
| S1 | Operator-honest landing hero copy — "InvestorPilot finds the right capital providers for your raise and the right buyers for your product, then drafts evidence-grounded outreach you approve before it ships." | `src/app/page.tsx:26-34` |
| S2 | Two-modes-one-workflow framing (Projects vs Products) named as the moat against Apollo. Worth $400/mo to Liam alone. | `src/app/page.tsx:36-40` |
| S3 | Score-tiered tone (high-fit direct ask / mid-fit hedged / low-fit exploratory) — the single sentence that made Liam sit up; this took his senior SDR two weeks to build in Lemlist liquid syntax. | `src/app/page.tsx:56-59` |
| S4 | 5-dimension ICP scoring (audience overlap, complementarity, partner readiness, reachability, leverage). Liam called it great. | `src/app/page.tsx:52-54`, weighting formula in `CLAUDE.md` |
| S5 | `finance_au_senior_debt` built-in compliance ruleset — Liam: "this is what would close the deal for me". | `src/app/page.tsx:76-79` |
| S6 | About-page disclaimer set: "Not a financial-advice service. Not a placement agent. Not a CRM. Not a substitute for legal review." Better than Apollo's equivalent. | `src/app/about/page.tsx` (confirmed referenced) |
| S7 | Auth page is the best in the portfolio (email + password + visibility toggle + forgot-password + magic-link + signup link). Liam: "your platform-trust and mmcbuild auth pages should learn from this one." | `src/app/(auth)/login/page.tsx` |
| S8 | Privacy doc names Supabase Auth + Unipile + Resend as sub-processors with token-custody disclosure. Auditable. | `src/app/privacy/page.tsx` |
| S9 | 8-stage playbook (Setup → Discovery → Scoring → Enrichment → Plan → Drafting → Approval → Track) — solid. | `src/app/playbook/page.tsx` |
| S10 | Hard-cap on out-of-scope candidates at 2/10 so they surface in the right bucket — "exactly the right design". | per `playbook` |
| S11 | 5-beat courtesy contract (Time-ack → Who-I-am → Why-you-personally → What-I-offer → Ask-last) — "would survive an audit". | per `playbook` |
| S12 | Warm 1st-degree vs cold 2nd-degree LinkedIn opener differentiation — Sales Nav can't do this without manual tagging. | per `playbook` |
| S13 | Resend webhook handles bounces and complaints; bounced email auto-marks `contact_partial` and clears the bad email. Audit-logged. | `src/app/api/webhooks/resend/route.ts`, `CLAUDE.md` status-sync rule |
| S14 | `/auth/callback` bare-GET correctly returns 307 → `/login?error=auth_failed`. Right behaviour, just unfriendly error string (see A2 below). | `src/app/(auth)/login/page.tsx` URL-param handling |

These do not need changes. Several should be amplified visually (sample
artifacts, screenshots) per Liam's "show, don't tell" feedback, but that is a
scope expansion conversation — out of the scope of this remediation plan.

---

## Action items (in priority order)

### A1 — PRIMARY BLOCKER: replace "Coming soon" on `/pricing` with founding-operator price band

**Severity:** MEDIUM per portfolio summary, **but the only buying blocker Liam named.** Treat as P0 for the next ship.

**Current state** (`src/app/pricing/page.tsx:13-75`):
- Page renders with a "Coming soon" amber badge and the title "Pricing".
- Body copy: "We're finalising plans across solo operators, teams, and agency operators…"
- Below the copy: `PricingSuggestionForm` (open textarea "What would this be worth to you?", optional use-case, optional email; honeypot anti-spam).
- Bottom card: "Until pricing lands — InvestorPilot is in active pre-launch. Founding-operator access is being granted case-by-case alongside counsel review."
- CTA: external link to Corporate AI Solutions about page.

**Liam's read** (verbatim from report):
> "Translation: you have no idea what to charge. Operators read this as 'we will charge whatever the market bears once we figure out what works.'… On the Wesbeam raise we sent 4,000 cold emails to wholesale investors… the platform that helped is the one we still pay $599/mo for. If you don't have a number on this page, I cannot put you in next year's budget."

**Proposed action (Option A — recommended):** *publish a founding-operator price band; keep the suggestion form below as secondary signal-gathering, not as the primary surface.*

Page restructure:
1. **Hero:** keep the page, replace "Coming soon" badge with **"Founding-operator pricing"** badge.
2. **Anchor band** (new card, primary surface, above the suggestion form):
   - **Solo operator** — $499/mo. One seat, one connected LinkedIn, one connected inbox, unlimited Projects + Products, full compliance rulesets including `finance_au_senior_debt`.
   - **Team of 5** — $1,499/mo. Five seats, shared dataroom + KB, per-member channel inventory, founder support.
   - **Agency / multi-raise** — "Talk to us." One line, one mailto/Calendly link.
   - Footnote: *"Founding-operator pricing locks in for 12 months from sign-up. Final pricing publishes Q3 2026."*
3. **"Request founding-operator access" CTA** (new button, primary): captures org name, raise type (Projects / Products / Both), current channel stack (free text), email. Route to a new `/api/founding-operator-request` endpoint that emails the founder via Resend (re-use existing `RESEND_FROM_EMAIL` + verified `updates.corporateaisolutions.com` sender per portfolio email rule). This becomes the conversion surface.
4. **Suggestion form** (keep, demote): keep the existing `PricingSuggestionForm` component below the anchor band as a "Not ready to commit? Tell us what it would be worth to you" secondary card. Existing `/api/pricing-suggestion` route stays untouched.

**Numbers are placeholders for Dennis approval.** $499 / $1,499 / "talk to us" matches Liam's verbatim suggestion in the report: *"founder pricing — $499/mo solo, $1499/mo team-of-5, talk to us for agency."* Dennis must confirm before publish.

**Files to change (no edits until approval):**
- `src/app/pricing/page.tsx` — replace hero badge, insert anchor-band card with three tiers, insert founding-operator-request CTA, demote suggestion form below.
- `src/app/pricing/pricing-suggestion-form.tsx` — no logic changes; possibly tighten the copy to read as a fallback ("Pricing not quite right? Tell us what fits.") rather than the primary ask.
- **New file** `src/app/api/founding-operator-request/route.ts` — POST handler, validates input, sends a transactional email via Resend to the founder address, returns 200/400. Mirror the auth pattern from `CLAUDE.md` (no `authenticateAndGetDb` needed because this is unauthenticated; rate-limit via a simple in-memory or DB-backed token bucket if abuse risk is real).
- **Optional** Supabase migration: a `founding_operator_requests` table to capture the submissions (id, created_at, org_name, raise_type, channel_stack, email, status). Apply via Supabase CLI per global rule, not by asking Dennis to paste SQL.

**Proposed action (Option B — fallback):** *remove the `/pricing` page entirely and redirect `/pricing` to `/about` until pricing is ready.*
- Simpler, lower risk.
- Costs the conversion surface entirely — Liam was looking for a number, removal removes the page that fails him but does not give him what he wanted.
- **Not recommended.** A blank page is still better than a "Coming soon" page in operator terms (no false signal), but a price band is better than both.

**Dennis decision needed:**
- Approve Option A (publish $499 / $1,499 / talk-to-us) — preferred.
- Or approve Option B (remove the page).
- Or override the price numbers with his own band before I implement.

**Estimated effort:** half a day for Option A (page restructure + new API route + Resend wiring + manual smoke test of the CTA submitting to founder inbox). One hour for Option B (redirect in `next.config.mjs` or middleware, plus copy update on `/about`).

---

### A2 — SECONDARY: soften the `/auth/callback` error string

**Severity:** LOW (Liam graded it as a minor polish, not a blocker).

**Current state:** `/auth/callback` returns `307 → /login?error=auth_failed` on bare GET. The login page reads the `error` query param and renders "auth_failed" or similar.

**Liam's read:**
> "The error message 'auth_failed' is unhelpful — show 'session expired, please sign in again' or similar. A real user hitting that page after a token timeout is going to bounce, not retry."

**Proposed action:** map known error codes to friendly strings in the login page's error renderer. Add a small mapping helper:
- `auth_failed` → "Session expired. Please sign in again."
- `link_expired` → "That magic link has expired. Send a fresh one below."
- `invalid_token` → "We couldn't verify that sign-in link. Try again."
- Default unknown → "Sign-in failed. Please try again or contact support."

**Files to change:**
- `src/app/(auth)/login/page.tsx` — add the mapping helper, render the friendly string instead of the raw param.

**Estimated effort:** 20 minutes.

---

### A3 — SECONDARY: surface AFSL-aware compliance copy on landing (move from feature #7 to a callout)

**Severity:** LOW-MEDIUM (Liam said this is *the headline for an AFSL-audited shop*, but it's currently feature card #7 of 12).

**Current state** (`src/app/page.tsx:76-79`): "Pre-send compliance filter" sits as one of 12 feature cards in a 3-column grid. The `finance_au_senior_debt` built-in ruleset is named in the body of that card.

**Liam's read:**
> "'Pre-send compliance filter… finance_au_senior_debt built in' — this is what would close the deal for me but the copy treats it like footer trivia. For an AFSL-audited shop, 'the platform refuses to send if you use the word guaranteed return' is the headline, not feature #7."

**Proposed action:** add a single-line callout strip *above* the 12-card grid, between the hero and the feature grid. One line, one icon, links to a future `/compliance` page (out of scope here; placeholder link for now).

Suggested copy:
> **Built for regulated raises.** Per-product compliance rulesets — including `finance_au_senior_debt` — refuse to send drafts that contain prohibited language (e.g. "guaranteed return"). Every send is approval-logged with operator ID, ruleset version, and timestamp. *[Compliance details →]*

Position: between the hero CTA buttons (`page.tsx:41-44`) and the feature grid (`page.tsx:47`). Visually a dark card with the `ShieldCheck` icon, full-width within the existing `max-w-6xl` container.

The existing "Pre-send compliance filter" feature card stays where it is — the callout amplifies it, doesn't replace it.

**Files to change:**
- `src/app/page.tsx` — insert one new `<section>` with the callout card between the hero and the feature grid.

**Estimated effort:** 30 minutes.

**Out of scope for this remediation:** the `/compliance` page itself (Liam's "Opportunity" about a /compliance page laying out audit log schema + ruleset contents + wholesale-vs-retail gating + data residency + audit-log export is a real future asset, but it's a half-day to a full-day build and belongs to a separate plan).

---

## Items explicitly *not* actioned (scope decisions)

These are findings from the report that I am **not** proposing to action in
this remediation. Each has a one-line justification so Dennis can override.

| # | Finding | Why not in this plan |
|---|---|---|
| N1 | "Drop the marketing page from 16 to 4 feature blocks" | Scope expansion; visual redesign belongs in a `/plan-design-review` cycle, not a remediation. Acknowledged as valid but deferred. |
| N2 | "List the 22 funding types" | Content gap, real; ~2hr work; belongs to a marketing copy pass, not this remediation. |
| N3 | Clay-as-enrichment-waterfall integration | Real product gap, multi-day build (waterfall logic + provider abstraction). Belongs to a roadmap discussion, not a Liam-feedback patch. |
| N4 | LinkedIn-rate-limiting cool-down explanation in `/playbook` | Real operator concern; copy update only. Add to a future marketing-copy pass. |
| N5 | "Add a what-brings-you-here radio on signup (Project / Product / Both)" | Worth doing, but invasive to the signup flow + has implications for onboarding routing. Belongs to onboarding-flow plan, not pricing remediation. |
| N6 | Password-visibility-toggle verification on `/login` | Liam couldn't confirm via scraped HTML. The component does include the toggle (per portfolio summary calling it "the best auth page in the portfolio"). Verify-only step, not an action. |
| N7 | About-page: surface Dennis's LinkedIn + AFSL background | Trust signal Liam asked for; ~30 minutes of copy work; defer to next about-page polish. |
| N8 | Contact-page: "Full registered address to be added" — replace with ABN + registered office + LinkedIn + Calendly | Real launch-blocker for regulated buyers. **Probably should be in this plan as A4.** Flag to Dennis: if he wants this in scope, it's a 1-hour change. |
| N9 | `/compliance` page (audit log schema, ruleset, wholesale-vs-retail gating, data residency, audit export) | Half-day to full-day; biggest sales-asset opportunity Liam named, but deserves its own plan, not a remediation patch. |
| N10 | CRM-integration listing (HubSpot / Salesforce / Pipedrive / Zapier roadmap) | Real buying blocker for the Apollo-replacement use case; copy update on `/about` or new `/integrations` page; defer to integrations plan. |
| N11 | Reply sentiment + auto-triage, Pause-on-news, Compliance-attestation-per-send, Conflict register, Quiet hours per geography, Operator handoff, Sample-to-Self homepage video | All feature ideas from Liam's "Other Strategic Feature Suggestions". Belongs to roadmap / `/office-hours`, not remediation. |
| N12 | Sample Pool Summary PDF on `/playbook` | Liam: "you've closed me 60%". Real conversion lever. ~2-4hr (generate one Pool Summary, host the PDF). Defer to marketing-asset plan. |

**Recommend re-grading:** N8 (contact page "registered address to be added") is a real launch blocker for a regulated-industry buyer. Suggest Dennis approves it as A4 in this same plan.

---

## Suggested A4 (if Dennis approves the scope-up)

### A4 — Replace "Full registered address to be added" with real address + ABN on `/contact`

**Severity:** LOW-MEDIUM. Quote from Liam: *"a buyer in financial services CANNOT enter into a contract with a company whose registered address is 'to be added.' That sentence has to go before launch."*

**Proposed action:**
1. Remove the "Full registered address to be added" line.
2. Add the Corporate AI Solutions ABN (Dennis to provide if not already in repo).
3. Add the registered office address (Dennis to confirm — use the Corporate AI Solutions registered address or a serviced address if applicable).
4. Optional: add Dennis's LinkedIn URL.
5. Optional: add a Calendly link for a 20-minute discovery call.

**Files to change:**
- `src/app/contact/page.tsx`

**Estimated effort:** 30 minutes assuming Dennis provides the ABN + registered address values.

**Dennis decision needed:** approve scope-up + provide ABN + provide registered address.

---

## Verification heuristic (before claiming done)

Per global CLAUDE.md:
- 375px mobile + 1280px laptop: verify `/pricing` reflows cleanly with the new three-tier anchor band (mobile: stack to single column; laptop: 3-up grid).
- Auth smoke test: `/signup`, `/login`, `/forgot-password`, `/auth/callback` — all four paths still execute end-to-end after any change. Even though this plan doesn't touch auth pages directly (except A2's friendly-error-string), the auth-smoke-test gate fires on every memory save in this repo.
- Run `/qa` or `/qa-only` on the live deployment after merge to confirm no regression on the landing → pricing → signup funnel.

---

## Ship gate

**Recommend NOT shipping** A1 + A3 in the same PR without Dennis explicitly
approving the proposed price band ($499 / $1,499 / talk-to-us). The price
numbers are the load-bearing decision in this entire plan; everything else is
copy and routing.

**Sequence:**
1. Dennis approves Option A vs Option B for A1.
2. Dennis approves (or overrides) the price band numbers.
3. Dennis approves A4 scope-up (or not).
4. Implement A1 + A2 + A3 (+ A4 if approved) in one branch.
5. `/review` before push.
6. `/ship` to create PR + bump VERSION + update CHANGELOG.
7. Verify live on the preview URL using `/browse` against the three reflow checkpoints.

End of plan.
---

## 2026-05-20 Re-sweep addendum (cheap-probe)

**Date:** 2026-05-20  
**Method:** automated HTTP probe (curl-equivalent) of root + 3 key routes (see `cais-shared-services/probe-roster-2026-05-20.json`)  
**Full portfolio brief:** `cais-shared-services/PORTFOLIO_NAIVE_RESWEEP_2026-05-20.md`

**Re-test result:** 🟡 AMBER

- Root: HTTP `200`
- Title: `InvestorPilot — Multi-channel direct outreach platform` (yes)
- Key routes resolving: **2/3**
- Broken: `/demo` (404)

**BYOK-ready determination:** **NO — persona findings + plumbing gaps still standing**

**What this re-test can and cannot say:**

- ✅ It confirms the URL plumbing reachable from a 2026-05-20 curl.
- ❌ It cannot verify the persona-level findings in this doc — copy quality, trust signals, CTAs that return 200 but go nowhere, RLS holes behind 200 auth pages.
- The persona findings above remain authoritative until each is individually re-tested.

<!-- /resweep-2026-05-20 -->
