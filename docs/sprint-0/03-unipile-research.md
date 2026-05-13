# Sprint 0 — Unipile Research Brief

**Date:** 2026-05-12
**Status:** Desk research complete. Live spike (separate doc 08) gates final commitment.
**Recommendation summary:** Unipile is the right vendor for InvestorPilot Phase 1-2, but the LinkedIn route is "reverse-engineered" (their words), which means LinkedIn ban risk is real and operator-managed. Run the spike (08) before committing.

---

## TL;DR

| Question | Answer |
|---|---|
| Is Unipile fit-for-purpose? | Yes for Phase 1-2 (LinkedIn connect + DM + email send via Gmail/Outlook + accepted-invitation webhooks). |
| What does it cost at our scale? | €49/month (≤10 accounts). Dennis-only Phase 1 = ~€49/month. |
| Does it enforce LinkedIn daily caps? | **No.** Unipile says "provider limits respected but not enforced by Unipile." Cap enforcement is **InvestorPilot's responsibility** (middleware-level, per CLAUDE.md). |
| Account-ban risk? | Material. Unipile uses reverse-engineering for LinkedIn (not official API). Mitigated by Unipile residential IPs + InvestorPilot enforcing conservative caps + warmup curve. |
| Email channel option? | Yes, Gmail + Outlook via OAuth. Counts as one account each. |
| Alternatives? | HeyReach + Nylas, native LinkedIn API (commercial only), build-your-own (very high risk). Detailed below. |

---

## Pricing (Australian implications)

Unipile pricing is post-paid, per linked account:

- **Starter:** €49/month for ≤10 accounts (€5 average per account)
- **Volume:** €5/account/month beyond 10, with volume discounts at scale
- **Per-account counting:** 1 LinkedIn = 1 account, 1 Gmail = 1 account, 1 Outlook = 1 account. A Gmail address with calendar bundle counts as 1 (not 2).
- **No per-message fees, no overages.** Provider rate limits apply.
- **Free trial:** 7 days, no credit card required.

### InvestorPilot scenarios

| Scenario | Accounts | Cost/month |
|---|---|---|
| Dennis only (LinkedIn + Gmail) | 2 | €49 |
| Dennis + Uwe (both LinkedIn + email) | 4 | €49 |
| Phase 6 white-label (5 client tenants, each LinkedIn + email) | 10 | €49 |
| Scale to 25 clients × 2 accounts | 50 | ~€250 |

**Verdict:** Unipile is inexpensive at our scale. Cost is not a blocker. Vendor lock-in / account-safety / SLA are the real questions.

---

## Capability Coverage vs. Phase 1-2 Requirements

| Phase 1-2 requirement | Unipile coverage | Notes |
|---|---|---|
| Send LinkedIn connection request with personalised note | Yes | `POST /chats` and invitation endpoints |
| Send LinkedIn DM after connection accepted | Yes | `POST /messages` |
| Webhook: connection accepted | Yes | "Detecting Accepted Invitations" event |
| Webhook: new LinkedIn message (reply) | Yes | "New messages" event |
| Send email from Gmail | Yes | OAuth Gmail integration |
| Send email from Outlook | Yes | OAuth Microsoft integration |
| Webhook: email reply / bounce | Yes | "New emails" + tracking events |
| Daily-cap enforcement (LinkedIn 20 connects, 30 DMs etc) | **No — must be enforced in InvestorPilot middleware** | Critical: build this in Phase 1, not Phase 2 |
| Warmup curve for new accounts (5 → 10 → 20 per day over 3 weeks) | **No — must be enforced in InvestorPilot middleware** | Same — Phase 1 |
| Account-health monitoring (rate-limit / captcha / lockout signals) | Yes (account-lifecycle webhooks + status updates) | Need to wire alerts |
| Calendar integration (Google + Microsoft) | Yes | Useful for Phase 4 deferred Calendar Agent |
| SDK | Node.js (official), n8n integration, MCP server | InvestorPilot is TypeScript / Next.js → Node SDK is right |
| Python | Not officially documented | Not needed |

**No coverage gap blocks Phase 1-2.** Cap and warmup enforcement is our work, not Unipile's.

---

## Critical Risks

### 1. LinkedIn account ban risk

Unipile's site explicitly notes that LinkedIn / Instagram / WhatsApp use "reverse engineering," while Gmail / Outlook / Telegram use official APIs. **LinkedIn is not blessing this access pattern.** Risks:

- Unipile detection: LinkedIn can fingerprint Unipile's automation signatures and mass-ban Unipile-connected accounts. This is a vendor-level systemic risk InvestorPilot cannot mitigate.
- Account-level detection: even if Unipile is undetected, individual account behavior (burst sends, foreign IPs, captcha challenges) can trigger account-specific bans.

**Mitigations:**
- Use Unipile's residential IP rotation (default).
- Enforce conservative caps server-side: max 15 connection requests/day in week 1, 20 from week 2+. Hard cap, no UI override.
- Warmup curve enforced for new accounts: 5/day week 1, 10/day week 2, 15-20/day week 3+.
- Random delays between actions (30s-180s).
- Working-hours-only enforcement (sender's local time, M-F).
- Account-health webhook → auto-pause + Slack/email alert.
- **Most important:** if Unipile mass-ban event happens, InvestorPilot's response must be to halt all LinkedIn channel sends globally within minutes. The kill-switch decision from D9 (Sprint 1 deliverable) needs to support per-channel and global pause.

### 2. Unipile vendor risk

- Unipile is a relatively small French company (founded ~2022).
- Vendor disappearing or being acquired and discontinued would force migration.
- SLA / support tier not investigated — needs spike step (08).
- Alternative chosen at Phase 1 should be re-evaluable at Phase 6 white-label.

### 3. Compliance pass-through

Unipile sends what we send. Pre-send compliance filter (regex + LLM) is fully InvestorPilot's responsibility. Unipile is dumb pipe for sending; smart pipe for receiving (parses replies, classifies channel).

---

## Alternatives Considered

### Option: HeyReach + Nylas

- **HeyReach** is LinkedIn-specific outreach automation. Stronger LinkedIn safety record than Unipile (more conservative defaults). $79/month/account, no email channel.
- **Nylas** is multi-provider email + calendar API. $50-200/month depending on tier. More mature than Unipile for email.
- **Combined:** ~$130-280/month for one Dennis-equivalent. Two vendors to integrate, two APIs, two failure modes.

**Vs Unipile:** More expensive, two integration surfaces, but theoretically lower LinkedIn risk + more mature email side. Worth keeping in pocket as a fallback if Unipile spike (08) fails.

### Option: Native LinkedIn API (Sales Navigator / Marketing Solutions)

- Official LinkedIn APIs exist but are gated to "approved partners" — Sales Navigator API is for CRMs (Salesforce, HubSpot), not custom outreach tools.
- Approval process: 3-6 months, no guarantee, often denied for cold-outreach use cases.
- **Not viable for InvestorPilot.**

### Option: Build LinkedIn automation ourselves (browser automation)

- Puppeteer/Playwright driving a logged-in LinkedIn session from a controlled server.
- Same LinkedIn TOS violation as Unipile, plus we own all the ban-risk mitigations.
- Significant ongoing maintenance (LinkedIn UI changes break selectors weekly).
- **High-risk and high-cost. Do not pursue.**

### Option: Email-only (defer LinkedIn entirely)

- Use Resend (already wired) for email channel; skip LinkedIn until D3 decision is reversed.
- Conversion math (Scenario A, doc 02) shows email-only does not hit 5/week.
- **Not aligned with D3 decision.** Only revisit if Unipile spike fails AND no acceptable alternative.

---

## Decision Matrix

| Criterion | Weight | Unipile | HeyReach+Nylas | Build own |
|---|---|---|---|---|
| Phase 1-2 capability coverage | 30% | 9/10 | 7/10 (no unified webhook surface) | 4/10 |
| LinkedIn account safety | 25% | 6/10 | 7/10 | 3/10 |
| Cost at our scale (<5 customers) | 10% | 9/10 (€49) | 6/10 ($130-280) | 4/10 (engineer time) |
| Time to integrate | 15% | 8/10 (1 SDK) | 5/10 (2 SDKs) | 1/10 (months) |
| Vendor risk | 10% | 6/10 (small vendor) | 8/10 (two mature vendors) | 10/10 (us) |
| Long-term flexibility | 10% | 7/10 | 7/10 | 9/10 |
| **Weighted score** | | **7.5** | **6.7** | **4.0** |

**Unipile wins on aggregate.** Spike (doc 08) decides whether it survives contact.

---

## Recommendation

1. **Proceed with Unipile** for Phase 1-2 contingent on spike (doc 08) passing all critical criteria.
2. **Build daily-cap and warmup enforcement in InvestorPilot middleware on day 1** — Unipile does not enforce this; this is the most important safety layer.
3. **Implement per-channel and global kill switch** (D9 / Sprint 1 deliverable) so a Unipile mass-ban event can be contained in seconds.
4. **Keep HeyReach + Nylas as documented fallback.** If Unipile fails the spike or has a serious vendor event during Phase 1, swap-out path is mapped.
5. **Calendar integration is "free" with Unipile** (Gmail / Outlook bundled). Use this for Phase 4 deferred Calendar Agent.
6. **OAuth flows:** plan for `/api/auth/unipile/{linkedin,gmail,outlook}/connect` and `/callback` routes. Unipile provides hosted white-label auth pages — we redirect to them rather than build our own consent UI.

---

## Open Questions for Spike (doc 08)

1. What's the actual API latency for `send connection request`? (Real-time? Async via queue?)
2. Does the webhook for "accepted invitation" fire reliably and within minutes?
3. What's the response when a daily cap is hit at LinkedIn's end? Error code? Silent fail?
4. Can we pause and resume an account programmatically without re-auth?
5. What happens to in-flight messages if we revoke the connection?
6. Support response time on a low-tier issue?
