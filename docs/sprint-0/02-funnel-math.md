# Sprint 0 — Funnel Math Model (v3, Lender Channel)

**Date:** 2026-05-13
**Version:** v3 — reset for senior debt syndicate per Senior Debt Brief v3
**Objective:** Fill the combined $18.7M senior debt platform within 3-6 months.

---

## Why this is a full reset

v1 modelled advisor → wholesale-client → meeting funnels to hit 5 meetings/week. v3 models a fundamentally different funnel: **lender prospect → credit conversation → indicative interest → term sheet → documented commitment**, with **fewer prospects, larger tickets, and a smaller universe**.

The "5 confirmed meetings per week with verified investors" framing from v1/v2 is replaced. New headline objective:

> **Fill $18.7M senior debt across Branscombe + Seafields syndicates within 3-6 months. Approximate composition: 4-8 lenders for Branscombe averaging $2-3M each; 1-3 lenders for Seafields averaging $1-2.5M each. Total ~7-11 documented commitments.**

---

## TAM — Australian + APAC private debt lender universe

The lender universe is much smaller than the advisor universe:

| Filter | Universe size (estimated) |
|---|---|
| All AU family offices | ~1,500-2,500 |
| With declared private debt / real-estate debt allocation | ~300-500 |
| Active in Australian property development debt | ~80-150 |
| Plus AU-mandate private credit funds sub-$200M AUM | +30-50 |
| Plus HNW individuals publicly lending into property | +50-100 |
| **AU total addressable** | **~160-300** |
| Singapore family offices with AU property exposure | ~50-100 |
| HK family offices with AU property exposure | ~30-60 |
| **APAC extended total** | **~240-460** |

Compared to the v1 advisor TAM of 240-480, the lender universe is similar in size but **much higher per-prospect value** (each conversion is worth $1-5M, not $125K).

---

## Funnel stages — conversion bands

Stage rates for senior-debt cold outreach to family offices / HNW private lenders. These are private-debt-market norms (not advisor-cold-outreach norms).

| Stage | Industry low | Industry high | F2K bet (anti-stall vs broker process) |
|---|---|---|---|
| LinkedIn connection accept | 30% | 45% | 35-50% (FO principals more receptive to direct contact than retail advisors) |
| Connected → reply to first DM | 8% | 20% | 12-25% (credit professionals reply when topic is well-targeted) |
| Email open rate (cold, FO target) | 35% | 55% | 45-60% |
| Email reply rate (cold) | 2% | 6% | 4-8% |
| Reply → indicative interest expressed | 25% | 45% | 35-50% |
| Indicative interest → term sheet conversation | 50% | 70% | 60-75% |
| Term sheet conversation → indicative commitment | 30% | 50% | 35-50% |
| Indicative commitment → documented | 60% | 80% | 65-80% |

### Compound conversion (touch → documented commitment)

```
LINKEDIN-ONLY (per connection request sent):
  Industry low:    0.30 × 0.08 × 0.25 × 0.50 × 0.30 × 0.60 = 0.054%
  Industry high:   0.45 × 0.20 × 0.45 × 0.70 × 0.50 × 0.80 = 1.13%
  F2K bet:         0.43 × 0.18 × 0.42 × 0.68 × 0.42 × 0.72 = 0.66%

EMAIL-ONLY (per email sent):
  Industry low:    0.02 × 0.25 × 0.50 × 0.30 × 0.60 = 0.045%
  Industry high:   0.06 × 0.45 × 0.70 × 0.50 × 0.80 = 0.76%
  F2K bet:         0.06 × 0.42 × 0.68 × 0.42 × 0.72 = 0.52%
```

These are MUCH lower compound rates than the v1 advisor funnel because there are MORE stages (the credit process has term sheet + documentation steps beyond meeting booking). But each conversion is worth $1-5M, not a $125K ticket.

---

## Scenarios

### Scenario A — LinkedIn only, single sender account

100 touches/week × 0.66% conversion = ~0.66 documented commitments/week.

Over 12 weeks: ~8 documented commitments. Plausibly enough to fill Branscombe (4-8 lenders) + close part of Seafields, **if** average ticket lands at $2-3M.

**Verdict:** Mathematically can hit the $18.7M objective on LinkedIn alone if the F2K-bet conversion holds. Margin is thin — each stage matters.

### Scenario B — LinkedIn + email co-equal (per D3 from CEO review)

- LinkedIn: 100 touches/week × 0.66% = 0.66/wk
- Email: 200 touches/week × 0.52% = 1.04/wk
- **Combined: ~1.7 documented commitments/week**

Over 12 weeks: ~20 commitments. **Comfortably exceeds the 7-11 needed for $18.7M.**

**Verdict:** Multi-channel approach gives meaningful margin. Excess conversion velocity translates to bigger average ticket size (lenders compete for participation) or faster close.

### Scenario C — Hyper-curated 30-prospect target list

Build a hand-curated list of 30 perfect-fit lenders (Sydney + Melbourne + Singapore FO principals with documented AU property dev debt history). Heavy personalisation per touch. 4-5 touches per prospect over 3 weeks.

Bet on much higher per-prospect conversion (60%+ engagement, 30%+ to indicative interest, etc.):

30 prospects × ~12% prospect-to-commitment = 3-4 commitments over 3-4 weeks. Then refresh list.

**Verdict:** Highest quality, slowest volume. Pair with Scenario B for fill: Scenario C drives the largest tickets, Scenario B fills the rest.

---

## Honest verdict on hitting $18.7M

| Scenario | Documented commitments / 12 weeks | Hits $18.7M? |
|---|---|---|
| A: LinkedIn only | ~8 | Marginal — depends on avg ticket |
| B: LinkedIn + email | ~20 | **Yes, comfortably** |
| C: Hyper-curated only | ~12 | Yes |
| B + C combined | ~25-30 | Yes — likely with selection of best ticketed lenders |

**Implication:** Multi-channel (D3) + hyper-curated overlay is the right operational mix. We can hit the $18.7M target within 12-16 weeks at this conversion math. **The bigger risk is not "can we hit the number" but "can we secure the right lenders" — pari-passu syndicate quality and long-term relationship potential matter as much as fill speed.**

---

## Sensitivity analysis

What changes if email reply rate is 2% vs 8%?

Scenario B, holding LinkedIn at F2K-bet:
- 2% email reply: 200 × 0.02 × 0.42 × 0.68 × 0.42 × 0.72 = 0.35/wk email → combined ~1.0/wk → 12 commitments / 12 weeks
- 4% email reply: 0.69/wk → 1.35/wk → 16/12wk
- 6% email reply: 1.04/wk → 1.7/wk → 20/12wk
- 8% email reply: 1.39/wk → 2.05/wk → 25/12wk

What changes if the term-sheet-to-commitment rate is 30% vs 50%?
- 30%: ~10 commitments / 12 weeks
- 40% (F2K bet): ~16
- 50%: ~22

**Highest-leverage levers (rank order):**
1. Email reply rate (driven by message quality + targeting precision)
2. Connection accept rate (driven by sender profile credibility)
3. Term-sheet-to-commitment (driven by sponsor track record + project quality — F2K-controlled)
4. Indicative interest → term sheet (driven by IM quality + responsiveness)

Practically: the largest lever InvestorPilot owns is **message quality + targeting precision**. The Senior Debt Brief Section 4 (lender ICP) drives targeting; Sections 5.5/5.6/5.7 (response scripts) drive messaging precision after first contact.

---

## Per-channel volume capacity (single Dennis-tier account)

| Channel | Daily cap | Weekly cap | Quality threshold |
|---|---|---|---|
| LinkedIn connection requests | 20/day | 100/wk | Personalised note required; one cap per Dennis-controlled LinkedIn |
| LinkedIn DMs (post-connection) | 30/day | 150/wk | Sequence-driven; respond within 24h of acceptance |
| Email touches (cold, via Resend warmup) | 30-50/day | 150-250/wk | Subject line A/B test; mobile-friendly preview |

Combined per-week capacity: ~250-350 touches across both channels. Comfortably fits Scenario B's volume needs.

---

## Headline dashboard specification (Sprint 1 deliverable, lender-tuned)

```
┌───────────────────────────────────────────────────────────┐
│  COMMITMENT TO TARGET                                      │
│  $11.4M committed / $18.7M target            61%          │
│  ─ Branscombe: $9.5M / $16.2M  (5 lenders confirmed)     │
│  ─ Seafields: $1.9M / $2.5M    (2 lenders confirmed)     │
│                                                            │
│  THIS WEEK                                                 │
│  ┌─────────┐                                              │
│  │   2     │  new lenders to documented stage              │
│  └─────────┘                                              │
│  ┌─────────┐                                              │
│  │   1     │  term sheet sent this week                    │
│  └─────────┘                                              │
│                                                            │
│  ▶ Funnel this week:                                       │
│    │ LinkedIn connection requests sent  98                  │
│    │ Connections accepted               42  (43%)          │
│    │ DMs sent                           38                  │
│    │ DM replies                          8  (21%)          │
│    │ Email touches sent                 185                 │
│    │ Email replies                       9  ( 5%)          │
│    │ Indicative interest expressed       6                  │
│    │ Term sheets in conversation         3                  │
│    │ Indicative commitments              2                  │
│    │ Documented commitments              1                  │
│                                                            │
│  ▶ Avg ticket size to date: $1.6M                         │
│  ▶ Largest single commitment: $4.2M (FO Singapore)         │
│  ▶ Days to first commitment: 24                            │
└───────────────────────────────────────────────────────────┘
```

This is the single most important Sprint 1 deliverable for accountability against the lender objective. Replaces the v1 "meetings/week" dashboard.

---

## Key differences from v1 funnel

| Aspect | v1 (advisor) | v3 (lender) |
|---|---|---|
| Headline metric | 5 meetings/week | $18.7M syndicate filled |
| Time horizon | 8-10 weeks | 12-16 weeks |
| Final conversion stage | Meeting held | Documented commitment |
| Funnel depth | 5 stages | 7 stages (adds term sheet + commitment + documentation) |
| Per-touch value | $125K potential | $1M-$5M potential |
| Universe size | ~240-480 (AU advisors) | ~240-460 (AU+APAC lenders) |
| Critical lever | Email reply rate | Email reply rate + term-sheet-to-commitment rate |
| Geographic priority | TAS + WA for project locality | Sydney + Melbourne + Singapore for FO concentration |
| Compound conversion | 0.5-1.5% per touch | 0.5-1.0% per touch (more stages but higher per-stage rates) |

The architectural funnel diagram from v1 still applies — discover → enrich → draft → send → track → reply classify → meeting book. What changes is the SEMANTIC of each stage and the FINAL outcome (commitment, not meeting).
