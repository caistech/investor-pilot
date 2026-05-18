# InvestorPilot — Outreach Messaging Framework

**Product:** Corporate AI Solutions — AI Builds for Operator-Led Businesses
**Applies to:** Products (Sales) outreach in InvestorPilot
**Audience:** Buyers — owners and operators of established, operator-led businesses

This file tells Claude Code how to tailor outreach messages for every prospect.
The six principles below are non-negotiable and apply to *every* message. What
changes between prospects is **tier** (connection degree) and **personalisation
depth** (how much we actually know about them).

---

## The 6 messaging principles (apply to EVERY message)

1. **Friendly** — Write like a real person reaching out, not a sales bot.
   No corporate throat-clearing, no "I hope this email finds you well."
2. **Courteous** — Respect their time. Acknowledge we're a stranger or
   semi-stranger asking for attention. Never presumptuous.
3. **To the point** — 3–5 short sentences for cold, slightly more room for
   warm. The whole message should be graspable in under 15 seconds.
4. **Offers value before the ask** — Lead with an insight, observation, or
   relevant proof point. The prospect gets something useful even if they
   never reply.
5. **The ask is tied to their situation** — Frame around *their* operational
   problem (a slow, costly, or broken workflow), not our product. We sell
   "AI solutions for business problems," so the ask must connect to a
   business problem they plausibly have.
6. **Includes the AI interviewer link** — Every message ends with a soft
   invitation to the intake link so they can describe their own problem on
   their own time:

   `https://connexions-silk.vercel.app/p/platform-trust-sprint-intake`

   The link is framed as *low-commitment and for their benefit*
   ("walks you through it in a few minutes," "no call needed"), never as
   "book a demo."

---

## Tier logic — what each prospect type sees

Classify every prospect into one of four tiers and apply the matching logic.
The biggest variable is how warm the relationship is.

### Tier 1 — 1st-degree LinkedIn connections (WARM)

We're already connected. Permission to be direct already exists.

- **Tone:** Familiar, relaxed. Reference the existing connection
  ("good to be connected," or a shared group/mutual context if known).
- **Value-first:** Lead with a genuine, specific observation about their
  business or industry.
- **The ask:** Direct but soft. We can name the offer plainly — they know us.
- **Link framing:** "If it's relevant, this walks through it" — casual.
- **Channel:** LinkedIn DM preferred. Keep it short — DMs that scroll get ignored.

### Tier 2 — 2nd-degree LinkedIn connections (LUKEWARM)

One mutual connection away. Some social proof exists; full trust does not.

- **Tone:** Warm but slightly more formal than Tier 1. Establish the bridge early.
- **Value-first:** Open with the mutual connection *or* a relevant proof point
  (e.g. the MMC Build result) — this borrows credibility.
- **The ask:** Slightly softer than Tier 1. Frame as "thought this might be
  relevant" rather than a pitch.
- **Link framing:** "No call needed — this just lets you describe what's slow
  on your side."
- **Channel:** LinkedIn connection request + note, or DM if already connected.

### Tier 3 — Lower-than-2nd-degree LinkedIn (COLD-ish)

Discovered via LinkedIn but no real network bridge.

- **Tone:** Polite, professional, concise. We are a stranger — earn the read.
- **Value-first:** Must lead with proof or a sharp industry-specific insight.
  No mutual connection to lean on, so the *insight itself* is the value.
- **The ask:** The softest version. We are offering a way for *them* to
  articulate a problem, not asking them to buy.
- **Link framing:** Position the link as the entire ask — "if a slow process
  comes to mind, this captures it in a few minutes."
- **Channel:** LinkedIn note (300-char limit — be ruthless) or email.

### Tier 4 — Brave search prospects (COLD)

Found on the open web. No LinkedIn relationship at all. Reached by email.

- **Tone:** Most courteous and most concise. Acknowledge the cold contact
  honestly without apologising for existing.
- **Value-first:** Lead with the strongest, most specific proof point we have
  *and* a reason we're contacting *them specifically* (their industry, a
  visible operational signal). Relevance is everything for cold email.
- **The ask:** Entirely problem-framed. Never "we'd love to work with you."
  Instead: "you may have a workflow that's costing more than it should."
- **Link framing:** The link is the only call to action. No phone number,
  no "reply to schedule." Just the intake link, framed as a few-minute,
  no-pressure way to describe their problem.
- **Channel:** Email. Needs a subject line.

---

## Personalisation depth (the second variable)

Independent of tier, grade how much you actually *know* about the prospect
and scale specificity accordingly.

- **High info** (job-management tools visible, recent hiring, specific vertical,
  posts about a pain point): Reference the concrete signal in the value line.
  This is where messages convert.
- **Low info** (just name, title, company, vertical): Fall back to the
  vertical-level pain point. Use the ICP verticals and the typical operator
  pain — manual processes, spreadsheets doing jobs they shouldn't, no in-house
  tech team.

**Rule:** Never fake specificity. A generic-but-honest message beats a falsely
personalised one.

### ICP verticals (for the value/bridge line)

Construction and modular building, trades and field services, manufacturing,
logistics and distribution, transport, property and real estate, professional
services — operationally heavy industries where manual process is a visible,
measurable cost.

### Proof points to draw from

- 35+ live AI platforms delivered.
- MMC Build platform for Australian modular construction: Stages 0–5 delivered
  in 5 weeks against a 14-week schedule.
- Fixed-price, delivered in weeks, no in-house developers needed.

---

## Hard exclusions — do NOT send to these

Drop these prospects before drafting:

- Businesses with an in-house technical or AI team.
- CTOs / engineering leads as the buyer (wrong fit — this offer is for
  businesses *without* that capability).
- Pre-revenue startups and venture studios (separate product profile).
- Large enterprises wanting heavy custom integration.
- Agencies looking for a white-label dev shop.
- Businesses with no budget allocated for tooling.

**Target buyer titles:** Owner, Managing Director, General Manager, Operations
Director, non-technical Founder — the person who controls budget and feels
the pain.

---

## Message anatomy (the skeleton — every message)

```
[1] Opener        -> friendly + tier-appropriate relationship hook
[2] Value line    -> insight or proof point (the "before the ask")
[3] Bridge        -> connect that value to a problem THEY plausibly have
[4] The ask       -> soft, problem-framed, tied to their situation
[5] The link      -> intake link, framed as low-commitment + for their benefit
[6] Sign-off      -> short, human
```

Cold messages compress steps 1–3; they never skip step 2.

---

## Worked examples

### Tier 1 — 1st-degree, high info (LinkedIn DM)

> Hi [Name] — good to be connected. I noticed [Company] is running on
> [simPRO/ServiceM8/etc.] — most operators I talk to have one process around
> that which is still half-manual and quietly expensive. We build production
> AI tools that close exactly those gaps, fixed-price, in weeks (no dev team
> needed). If a slow process comes to mind, this AI interviewer captures it
> in a few minutes — no call required:
> https://connexions-silk.vercel.app/p/platform-trust-sprint-intake
> — Dennis

### Tier 2 — 2nd-degree, low info (connection note)

> Hi [Name] — we're connected through [Mutual]. We build fixed-price AI tools
> for operator-led businesses in [vertical] — recently delivered a
> modular-construction platform in 5 weeks against a 14-week schedule. If
> there's a workflow on your side that's slower or costlier than it should be,
> this walks through it in a few minutes, no call: [link]

### Tier 3 — lower-than-2nd-degree (LinkedIn note, ~300 chars)

> Hi [Name] — we build fixed-price AI tools for [vertical] businesses without
> an in-house tech team. 35+ delivered. If one slow, costly process at
> [Company] comes to mind, this captures it in a few minutes, no call: [link]

### Tier 4 — Brave / cold email

> **Subject:** A faster way to fix one slow workflow at [Company]
>
> Hi [Name],
>
> I'll be brief — we work with [vertical] businesses that know a process is
> slow or costly but don't have a tech team to fix it. We've delivered 35+
> live AI platforms, including one that shipped in 5 weeks against a 14-week
> schedule.
>
> If a costly manual process at [Company] comes to mind, this AI interviewer
> lets you describe it in a few minutes — no call, no commitment:
> https://connexions-silk.vercel.app/p/platform-trust-sprint-intake
>
> Either way, worth a look.
>
> — Dennis, Corporate AI Solutions

---

## Quick reference table

| | Tier 1 (1st) | Tier 2 (2nd) | Tier 3 (<2nd) | Tier 4 (Brave/cold) |
|---|---|---|---|---|
| **Relationship** | Connected | 1 mutual | None on LI | None at all |
| **Tone** | Familiar | Warm, semi-formal | Polite, concise | Most courteous, tightest |
| **Length** | 4–6 sentences | 4–5 | 3–4 | 4–5 + subject line |
| **Value line** | Specific observation | Mutual OR proof point | Proof or sharp insight | Strongest proof + why-them |
| **Ask hardness** | Direct but soft | Softer | Softest | Problem-framed only |
| **Channel** | LI DM | LI note/DM | LI note or email | Email |
| **Link framing** | "if relevant" | "no call needed" | "the whole ask" | "only CTA, few mins" |

---

## Checklist before any message is sent

- [ ] Prospect is NOT on the hard-exclusion list.
- [ ] Tier correctly identified (1 / 2 / 3 / 4).
- [ ] All 6 principles present.
- [ ] Value appears BEFORE the ask.
- [ ] Ask is framed as the prospect's problem, not our product.
- [ ] Intake link included and framed as low-commitment.
- [ ] Length matches the tier.
- [ ] No faked personalisation.
