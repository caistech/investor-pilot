# Sprint 0 — Draft Email Message Templates (v3, Lender Channel)

# ⚠ REQUIRES COUNSEL SIGN-OFF BEFORE ANY USE

**These drafts have not been reviewed by AFSL-qualified counsel.**
**Australian Spam Act 2003 applies — B2B sender identification + functional unsubscribe + accurate "From" address remain mandatory. Counsel must confirm AFSL position for soliciting senior debt lenders (Sec 5.8) before any cold messages ship.**

---

## Variable placeholders

Same as LinkedIn (doc 06): `{first_name}`, `{firm}`, `{credit_signal}`, `{ticket_band}`, `{lead_facility}`, `{sender_name}`, `{sender_role}`.

Additional email-specific:
| Token | Source | Example |
|---|---|---|
| `{firm_one_line}` | Firm research | "20 years of private debt across AU property" |
| `{firm_website}` | Hunter / Brave | "wilsoncapital.com.au" |
| `{calendar_link}` | Operator config | "https://cal.com/dennis-f2k/credit-call" |
| `{unsubscribe_link}` | Resend per-recipient | unique URL |
| `{f2k_address}` | F2K config | Uwe to provide |

---

## First-touch email — variant A (Direct, project-led)

**Subject:** `{first_name} — F2K $18.7M senior debt across two AU property projects`
**Alt subject (test):** `{first_name} — direct senior debt placement, AU property`

```
Hi {first_name},

F2K Capital is placing senior debt directly with selected lenders into two
Australian property development projects, replacing a stalled broker process.
{credit_signal} suggested {firm} may be in the market for this kind of position.

Brief facts:

  Project 1 — Branscombe Estate, Claremont TAS
  · 37 × 3-bedroom modular dwellings, planning approved (PLN-21-408.02)
  · $25.15M GRV, 22.2% margin on GRV
  · Senior construction facility: $16.2M @ 8.5% indicative + standard fees
  · ~22 months, first-mortgage, 40% anchor offtake to Homes Tasmania
  · Co-developer Barr Builders (land + builder of record), Unison Modular supply

  Project 2 — Seafields Estate, Waggrakine WA
  · 141 residential lots in 442-lot master-planned community
  · $21.15M GRV, tri-party Cooperation Agreement signed 19 Mar 2026
  · Senior land facility: $2.5M @ 8.0% capitalised
  · Day-1 LVR 71%, dropping to 24% within 6 months at developer's cost
  · Partner Humfrey Land Developments (2,000+ Mid-West lots, 15+ years)

Lenders can take either facility individually or combined. Pari-passu in
syndicate, $1-5M tickets typical. Documentation 4-6 weeks from indicative
interest.

V10 Finance Submissions and credit models available on request.

If a 20-minute credit conversation would be useful: {calendar_link}. If not
relevant, completely understand.

Best,

{sender_name}
{sender_role}
F2K Capital
{firm_website}

---
F2K Capital | {f2k_address}
{unsubscribe_link}
```

## First-touch email — variant B (Combined platform position)

**Subject:** `{first_name} — direct senior debt placement, $18.7M AU property platform`

```
Hi {first_name},

F2K is raising $18.7M senior debt across two AU property development projects:
Branscombe Estate (TAS, $16.2M modular construction) and Seafields Estate (WA,
$2.5M residential land). First-mortgage, wholesale, fixed-term.

{credit_signal} suggested {firm} may have appetite for this kind of position.

Combined story:
  · Geographic diversification (TAS + WA)
  · Product diversification (construction + subdivision)
  · Government offtake optionality both sides (Homes Tasmania for Branscombe,
    GROH for Seafields)
  · Indicative rates 8.5% (Branscombe) and 8.0% (Seafields)
  · Repeat business pipeline — written invitation from Premier Rockliff for
    ~200-home Homes Tasmania tender Q3/Q4 2026

Lenders can take either facility individually or both. Pari-passu in syndicate,
$1-5M tickets typical. V10 IMs + financial models available.

20-min credit conversation: {calendar_link}.

Best,

{sender_name}
F2K Capital, {firm_website}

---
F2K Capital | {f2k_address}
{unsubscribe_link}
```

## First-touch email — variant C (Single-facility led, smaller ticket lenders)

**Subject:** `{first_name} — $2.5M WA land senior debt — first-mortgage, signed Coop Agreement`

```
Hi {first_name},

Quick note: F2K Capital is placing $2.5M senior land debt into Seafields Estate
in Waggrakine WA (~8km north of Geraldton CBD). First registered mortgage over
141 residential lots; tri-party Cooperation Agreement signed 19 March 2026 with
Humfrey Land Developments (Mid-West region developer, 2,000+ lots track record).

  · $2.5M facility @ 8.0% p.a. capitalised
  · First mortgage over all 141 lots from Day 1
  · Day-1 LVR 71% (broadacre), dropping to 24% within 3-6 months as Humfrey
    delivers civil infrastructure at their cost — not ours
  · Repayment from per-lot apportioned principal ($17,730/lot, first priority
    per Clause 8.7 of signed Agreement)
  · ~36 months across staged settlements
  · 14-lot GROH (WA Housing Authority) lease anchor in advanced discussions

{credit_signal} suggested {firm} may be a fit for a smaller-ticket lot facility
like this. Worth a brief conversation?

V10 Finance Brief + Cooperation Agreement available on request.

{calendar_link} | otherwise no follow-up needed.

— {sender_name}, F2K Capital

---
F2K Capital | {f2k_address}
{unsubscribe_link}
```

### Variant recommendations (per lender size + scoring)

| Lender ticket band | Variant | Rationale |
|---|---|---|
| Large ($3M+) | A or B | A leads with diversification narrative; B = combined platform pitch |
| Mid ($1-3M) | A | Standard pitch; can take either facility |
| Smaller (sub-$1M considered case-by-case) | C | Seafields-led; smaller absolute commitment |

Routing decision per lender is driven by the discovery scoring (`audience_overlap_score` semantic = capital available per cheque).

---

## Follow-up #1 (4 days after first email, no reply)

**Subject:** `Re: {first_name} — F2K $18.7M senior debt across two AU property projects`

```
Hi {first_name},

Bumping this — short check that the message landed. The V10 Finance Submissions
include detailed credit models, security analysis, and offtake structure for
both projects.

If a 20-minute call this week or next would be useful: {calendar_link}.
If not relevant or not the right moment, reply "not now" and I'll stop.

— {sender_name}

---
F2K Capital | {f2k_address}
{unsubscribe_link}
```

## Follow-up #2 (7 days after FU#1, still no reply)

**Subject:** `{first_name} — closing the loop on F2K`

```
Hi {first_name},

Last note from me. Closing the loop on the F2K senior debt placement.

If the facilities become relevant later (or you'd like to be kept in mind for
the Q3/Q4 ~200-home Homes Tasmania tender pipeline), the door stays open:
{calendar_link}.

Otherwise, best of luck with {firm}'s work in {credit_signal}.

— {sender_name}
F2K Capital

---
F2K Capital | {f2k_address}
{unsubscribe_link}
```

After this, the prospect's sequence exits unless they reply. Re-engagement is manual or via "warm reopen" template (Phase 2).

---

## Subject line A/B test plan (Sprint 1)

| Subject | Hypothesis | Cohort |
|---|---|---|
| `{first_name} — F2K $18.7M senior debt across two AU property projects` | Personalised + specific + concrete | 20 |
| `{first_name} — direct senior debt placement, AU property` | Personalised + soft frame | 20 |
| `{first_name} — direct senior debt placement, $18.7M AU property platform` | Personalised + combined platform pitch | 20 |

Measure: open rate (~target 40%+), reply rate (~target 4%+). Winner becomes default after week 1.

---

## ⚠ FORBIDDEN PHRASES (HARD BLOCK in pre-send filter)

Lender-channel-specific (in addition to standard list from file 06):

```
- "exclusive offer" / "limited spots"
- "act now" / "today only" / "this week only"
- "click here to invest" / "click below"
- "guaranteed [anything]"
- "high yield" / "high return"
- specific percentage returns beyond IM rates (8.5%, 8.0%, 8-8.5%, 8-11% range from brief)
- specific dollar amounts beyond confirmed figures ($16.2M, $2.5M, $18.7M, $25.15M, $21.15M, $500K, $200K)
- BUY NOW / ACT FAST / all-caps urgency
- "no obligation" (suggests obligation otherwise)
- specific tax claims without context
- emojis anywhere (especially subject line)
- "FREE" / "Free!"
- "tokenisation" / "tokenised" / "crypto" / "blockchain" / "RWA" / "on-chain" (Sec 5.7 — do not surface unprompted)
- "retail investors" / "your clients" (wrong audience model)
- "advisor" except in proper-name compound (e.g., "credit advisor" — even then flag)
```

## ⚠ SPAM-TRIGGER WORDS (deliverability soft flag)

```
- "investment opportunity"
- "income stream"
- "passive income"
- "wealth building"
- "financial freedom"
- "click below"
- "limited time"
- multiple exclamation marks
- $ in subject line (use only in body)
- ALL CAPS WORDS
```

---

## Email deliverability checklist (Sprint 1 ops)

- [ ] Custom domain configured in Resend (e.g., `direct.f2kcapital.com.au`)
- [ ] SPF record published
- [ ] DKIM record published
- [ ] DMARC record `p=none` during warmup, `p=quarantine` post-warmup
- [ ] Reply-to address monitored mailbox
- [ ] Resend domain reputation warmed (20/day for first 3 days, 50/day for next 4 days, 150-250/day from week 2)
- [ ] Bounce webhook configured at `/api/webhooks/resend` with Svix signature validation
- [ ] Complaint webhook configured
- [ ] Footer with physical address — F2K to provide
- [ ] Functional unsubscribe link per recipient (token-based, marks `outreach_log.unsubscribed_at`)
- [ ] Plain-text alternative generated alongside HTML

---

## Once counsel signs off

1. Approved templates go into `sequence_templates.steps[].body_template` for lender channel.
2. Unsubscribe link logic implemented as Sprint 1 deliverable.
3. Footer + sender-domain warmup plan drafted before first send.
4. Counsel sign-off recorded in `docs/sprint-0/legal-signoff-2026-XX-XX.md` referencing exact email template versions + subject line variations approved.
