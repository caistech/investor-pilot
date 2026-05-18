# InvestorPilot — Outreach Messaging Framework

**Applies to:** every outreach surface in InvestorPilot — Products (Sales)
AND Projects (Funding).
**Audience:** depends on the offering — buyers when selling a product,
investors/lenders when seeking capital.

This file tells Claude Code how to tailor outreach messages for every
prospect, regardless of mode. The six principles below are non-negotiable
and apply to *every* message. What changes between prospects is **tier**
(connection degree), **personalisation depth** (how much we know about
them), and **mode** (which kind of proof / CTA bank to draw from).

---

## Two modes, same patterns

InvestorPilot supports two outreach directions. The shape of the message
is identical; only the *content bank* changes.

| | Sales (Products) | Funding (Projects) |
|---|---|---|
| **Goal** | Sell the offering to operators | Source capital for the offering |
| **Prospect** | Buyer / decision-maker inside an operator-led business | Investor / lender / allocator inside a fund or family office |
| **Value line** | Industry observation + product proof point | Sponsor track record + relevant deal proof |
| **The ask** | Workflow problem ("a slow process worth fixing") | Capital fit ("an asset class worth a look") |
| **CTA** | AI interviewer intake link (low-commitment) | Deck / one-pager / intro call (operator-set) |

The 6 principles, the 4 tiers, the message anatomy, and the exclusion
checklist all apply to BOTH modes without modification.

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
   problem (Sales) or *their* portfolio fit (Funding). Never lead with
   what we want. Always lead with why this is relevant to them.
6. **Includes a single low-commitment CTA** — Every message ends with a
   soft invitation to a *for-their-benefit* artefact:
   - **Sales:** AI interviewer link
     (`https://connexions-silk.vercel.app/p/platform-trust-sprint-intake`),
     framed as "walks you through it in a few minutes," "no call needed."
   - **Funding:** deck, one-pager, or 15-min intro — whatever the
     operator has configured on the project. Framed as "if it looks
     relevant," not "book a meeting."

---

## Tier logic — what each prospect type sees

Classify every prospect into one of four tiers and apply the matching
logic. Tiers map to network distance + how cold the relationship is, and
work identically across both modes.

### Tier 1 — 1st-degree LinkedIn connections (WARM)

Already connected. Permission to be direct already exists.

- **Tone:** Familiar, relaxed. Reference the existing connection.
- **Value-first:** Lead with a genuine, specific observation about their
  business / portfolio / thesis.
- **The ask:** Direct but soft. Mode-specific:
  - Sales: name the offer plainly — they know us.
  - Funding: state the asset class + sponsor + ticket band plainly.
- **Link framing:** "If it's relevant, this walks through it" — casual.
- **Channel:** LinkedIn DM preferred. Keep it short.

### Tier 2 — 2nd-degree LinkedIn connections (LUKEWARM)

One mutual connection away. Some social proof exists; full trust does not.

- **Tone:** Warm but slightly more formal than Tier 1.
- **Value-first:** Open with the mutual connection *or* a relevant proof
  point (product proof for Sales / deal proof for Funding) — borrows
  credibility.
- **The ask:** Slightly softer than Tier 1. "Thought this might be
  relevant" rather than a pitch.
- **Link framing:** "No call needed — this just lets you describe what's
  slow" (Sales) / "Deck attached if you want the structure" (Funding).
- **Channel:** LinkedIn connection note, or DM if already connected.

### Tier 3 — Lower-than-2nd-degree LinkedIn (COLD-ish)

Discovered via LinkedIn but no real network bridge.

- **Tone:** Polite, professional, concise. We are a stranger — earn the read.
- **Value-first:** Must lead with proof or a sharp industry-specific
  insight. No mutual connection to lean on, so the *insight itself* is
  the value.
- **The ask:** The softest version. We are offering a way for *them* to
  evaluate — not asking them to commit.
- **Link framing:** Position the link / deck as the entire ask — "if a
  slow process comes to mind, this captures it in a few minutes" (Sales)
  / "if it fits the mandate, the deck is the fastest read" (Funding).
- **Channel:** LinkedIn note (300-char limit — be ruthless) or email.

### Tier 4 — Brave search prospects (COLD)

Found on the open web. No LinkedIn relationship at all. Reached by email.

- **Tone:** Most courteous and most concise. Acknowledge the cold contact
  honestly without apologising for existing.
- **Value-first:** Lead with the strongest, most specific proof point we
  have *and* a reason we're contacting *them specifically* (their vertical,
  a visible operational signal, a fund mandate alignment). Relevance is
  everything for cold email.
- **The ask:** Entirely problem-framed (Sales) or fit-framed (Funding).
  Never "we'd love to work with you." Instead: "you may have a workflow
  that's costing more than it should" / "this may fit the construction-
  finance slice of your mandate."
- **Link framing:** The single CTA. No phone number, no "reply to
  schedule." Just the interviewer link (Sales) or deck (Funding).
- **Channel:** Email. Needs a subject line.

---

## Personalisation depth (the second variable)

Independent of tier, grade how much you actually *know* about the prospect
and scale specificity accordingly.

- **High info** (Sales: job-management tools visible, recent hiring,
  specific vertical, posts about a pain point. Funding: stated thesis,
  recent deal participation, fund-of-record on a comparable, public
  mandate): reference the concrete signal in the value line. This is
  where messages convert.
- **Low info** (just name, title, company/fund, vertical): fall back to
  vertical-level pain (Sales) or asset-class-level fit (Funding).

**Rule:** Never fake specificity. A generic-but-honest message beats a
falsely personalised one.

### Sales mode — ICP verticals (for the value/bridge line)

Construction and modular building, trades and field services,
manufacturing, logistics and distribution, transport, property and real
estate, professional services — operationally heavy industries where
manual process is a visible, measurable cost.

### Funding mode — asset classes (for the value/bridge line)

Construction finance / senior debt, real estate private credit, modular
construction equity, B2B SaaS Series A/SAFE, infrastructure debt — match
the project's `funding_type` + `asset_class` to the allocator's stated
mandate.

### Proof points to draw from

**Sales (default proofs):**
- 35+ live AI platforms delivered.
- MMC Build platform for Australian modular construction: Stages 0–5
  delivered in 5 weeks against a 14-week schedule.
- Fixed-price, delivered in weeks, no in-house developers needed.

**Funding (per-project proofs):**
Draw from the project's configured fields — `sponsor`, `funding_target`,
`asset_class`, `geography`, deck URL, one-pager URL. Add the comparables
the operator has put in the project's KB.

---

## Hard exclusions — do NOT send to these

### Sales mode

- Businesses with an in-house technical or AI team.
- CTOs / engineering leads as the buyer.
- Pre-revenue startups and venture studios.
- Large enterprises wanting heavy custom integration.
- Agencies looking for a white-label dev shop.
- Businesses with no budget allocated for tooling.

**Target buyer titles:** Owner, Managing Director, General Manager,
Operations Director, non-technical Founder — the person who controls
budget and feels the pain.

### Funding mode

- Allocators whose stated mandate excludes the project's asset class.
- Tokenisation / crypto / RWA platforms (forbidden vocabulary per
  compliance — see `src/lib/compliance/rules.ts`).
- Friends-and-family or angel-only investors when the project is
  institutional-sized.
- Domestic-only lenders when the project needs cross-border capital
  (e.g. AU domestic property credit for offshore modular construction).

**Target investor titles:** Principal, Managing Partner, Investment
Director, Portfolio Manager, Head of Private Credit, Family Office CIO
— decision-makers, not analysts.

---

## Message anatomy (the skeleton — every message, both modes)

```
[1] Opener        -> friendly + tier-appropriate relationship hook
[2] Value line    -> insight / proof point (the "before the ask")
[3] Bridge        -> connect that value to a problem (Sales) or fit (Funding) THEY plausibly have
[4] The ask       -> soft, problem-framed or fit-framed, tied to their situation
[5] The link/CTA  -> intake link (Sales) or deck/one-pager (Funding), framed as low-commitment + for their benefit
[6] Sign-off      -> short, human
```

Cold messages compress steps 1–3; they never skip step 2.

---

## Worked examples

### Sales — Tier 1, 1st-degree, high info (LinkedIn DM)

> Hi [Name] — good to be connected. I noticed [Company] is running on
> [simPRO/ServiceM8/etc.] — most operators I talk to have one process
> around that which is still half-manual and quietly expensive. We build
> production AI tools that close exactly those gaps, fixed-price, in
> weeks (no dev team needed). If a slow process comes to mind, this AI
> interviewer captures it in a few minutes — no call required:
> https://connexions-silk.vercel.app/p/platform-trust-sprint-intake
> — Dennis

### Sales — Tier 3, lower-than-2nd-degree (LinkedIn note, ~300 chars)

> Hi [Name] — we build fixed-price AI tools for [vertical] businesses
> without an in-house tech team. 35+ delivered. If one slow, costly
> process at [Company] comes to mind, this captures it in a few minutes,
> no call: [link]

### Funding — Tier 1, 1st-degree (LinkedIn DM)

> Hi [Name] — good to be connected. We're working with [Sponsor] on a
> [AUD 50M] [senior-debt facility / Series A] for [asset class +
> geography]. The structure is the same shape your fund did with
> [comparable] in [year]. If the construction-finance slice of your
> mandate is still active, the deck is a 5-min read:
> [deck_url]
> — Dennis

### Funding — Tier 4, cold email

> **Subject:** [Sponsor] [asset class] — fit check for [Allocator]?
>
> Hi [Name],
>
> I'll be brief — we're raising [AUD 50M] for [Sponsor]'s
> [construction-debt-senior] facility against [physical asset] in
> [geography]. [Public mandate signal — e.g. "your Q1 letter noted a
> rotation into private credit"] suggested it might fit.
>
> Deck (5-min read) if it's worth a look: [deck_url]
>
> No reply needed if it doesn't sit in the mandate. Either way, worth a
> quick look.
>
> — Dennis, Corporate AI Solutions

---

## Quick reference table

| | Tier 1 (1st) | Tier 2 (2nd) | Tier 3 (<2nd) | Tier 4 (Brave/cold) |
|---|---|---|---|---|
| **Relationship** | Connected | 1 mutual | None on LI | None at all |
| **Tone** | Familiar | Warm, semi-formal | Polite, concise | Most courteous, tightest |
| **Length** | 4–6 sentences | 4–5 | 3–4 | 4–5 + subject line |
| **Value line (Sales)** | Specific observation | Mutual OR product proof | Sharp insight | Strongest proof + why-them |
| **Value line (Funding)** | Sponsor + structure | Mutual OR deal proof | Asset-class proof | Mandate signal + why-them |
| **Ask hardness** | Direct but soft | Softer | Softest | Problem-/fit-framed only |
| **Channel** | LI DM | LI note/DM | LI note or email | Email |
| **CTA (Sales)** | Intake "if relevant" | Intake "no call needed" | Intake "the whole ask" | Intake "only CTA" |
| **CTA (Funding)** | Deck "if it fits" | Deck "no call needed" | Deck "the whole ask" | Deck "only CTA" |

---

## Checklist before any message is sent

- [ ] Prospect is NOT on the mode-appropriate hard-exclusion list.
- [ ] Tier correctly identified (1 / 2 / 3 / 4).
- [ ] All 6 principles present.
- [ ] Value appears BEFORE the ask.
- [ ] Ask is framed as the prospect's problem (Sales) or fit (Funding),
      not our product/raise.
- [ ] Single low-commitment CTA included and framed for-their-benefit.
- [ ] Length matches the tier.
- [ ] No faked personalisation.
