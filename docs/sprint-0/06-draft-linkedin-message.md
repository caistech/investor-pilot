# Sprint 0 — Draft LinkedIn Message Templates (v3, Lender Channel)

# ⚠ REQUIRES COUNSEL SIGN-OFF BEFORE ANY USE

**These drafts have not been reviewed by AFSL-qualified counsel.**
**The lender outreach context is materially different from advisor outreach — wholesale-borrower solicitation rules apply (Sec 5.8 of brief). Counsel must confirm AFSL position for soliciting senior debt lenders before any cold messages ship.**

---

## Compliance principles applied (lender channel)

Credit conversation, not product-suitability conversation. Lenders expect:
- Specific facility size, security position, expected return
- Concrete project — named, locatable, documented
- Sponsor track record citations
- No hype, no urgency, no marketing speak

Rules applied:
- Quoted indicative rate AT MOST in second-touch (after acceptance), never in connection request
- Facility size in first DM after acceptance (concrete is good — lenders need to know if it fits their cheque size)
- LVR + security position explicit by second-touch
- No "guaranteed" / "risk-free" language (counsel will block)
- No retail-investor language — lenders are not retail
- Stamford/Front response per Sec 5.5: soft framing in cold ("running a direct process to selected lenders"); direct framing in conversation
- Tokenised fund response per Sec 5.7: only addressed if the lender raises it; script in Inbox Agent

---

## Variable placeholders

| Token | Source | Example fill |
|---|---|---|
| `{first_name}` | LinkedIn profile / Hunter | "James" |
| `{firm}` | LinkedIn / firm research | "Wilson Capital Partners" |
| `{credit_signal}` | Discovery prompt output — public evidence of AU property dev debt | "your firm's participation in the Pacific Vista BTR facility (2024)" |
| `{ticket_band}` | Scoring rubric capital-available dimension | "$2-5M tickets" |
| `{lead_facility}` | Per-lender routing (combined / Branscombe / Seafields) | "the combined Branscombe + Seafields position" |
| `{sender_name}` | Sender | "Dennis McMahon" |
| `{sender_role}` | Sender role | "Development Manager, Factory2Key Pty Ltd" |

Every message MUST include `{credit_signal}` populated. Pre-send filter blocks any message where `{credit_signal}` is empty or generic.

---

## Connection request — variant A (Credit-signal-led)

LinkedIn limits notes to 300 characters.

```
{first_name} — F2K is placing two AU property dev senior debt facilities directly with selected lenders. {credit_signal} suggests fit. Wholesale, first-mortgage, $1-5M tickets. Open to a brief conversation? — {sender_name}
```

Example fully substituted (290 chars):
> James — F2K is placing two AU property dev senior debt facilities directly with selected lenders. Your firm's participation in the Pacific Vista BTR facility (2024) suggests fit. Wholesale, first-mortgage, $1-5M tickets. Open to a brief conversation? — Dennis McMahon

## Connection request — variant B (Concrete facility-led)

```
{first_name} — placing $16.2M AU residential modular senior construction debt + $2.5M WA land facility. First-mortgage, 8-8.5%, ~22mo. {credit_signal} suggests fit. Worth a 20-min call? — {sender_name}
```

## Connection request — variant C (Track-record-led)

```
{first_name} — running a direct lender process for two AU property dev facilities. Modular construction TAS + residential land WA, combined $18.7M. Your work in {credit_signal} suggests likely fit. Brief conversation? — {sender_name}
```

### Variant recommendations

- **A** (credit-signal-led) for Sprint 1 default — leverages discovery's strongest predictor (existing track record)
- **B** (concrete-facility-led) when scoring is high on capital + asset class but credit_signal evidence is thin
- **C** (track-record-led) for higher-tier ICP scores (≥9/10) where personalisation investment is justified

---

## First DM after connection accepted

Send 24-48h after accept. Keep under 150 words. Include the key facility specifics — credit teams need concrete numbers fast.

### Variant A — Full disclosure (recommended for ≥8/10 scored lenders)

```
Thanks for connecting, {first_name}.

Short context: F2K (factory2key.com.au) is placing senior debt directly into two
Australian property development projects, replacing a stalled broker process. Both
facilities are first-mortgage, wholesale, fixed-term.

  ▸ Branscombe Estate (Claremont TAS) — $16.2M senior construction. 37 modular
    dwellings. Indicative 8.5% p.a. + standard fees. ~22mo term. 40% anchor
    offtake to Homes Tasmania (CHP route).

  ▸ Seafields Estate (Geraldton WA) — $2.5M senior land. 141 residential lots,
    tri-party Cooperation Agreement signed. Indicative 8.0% p.a. capitalised.
    Day-1 LVR 71%, dropping to 24% within 6 months at developer's cost.

Open to either facility individually or combined. Lenders pari-passu in syndicate.

If a 20-minute credit conversation is useful, I can share the V10 Finance
Submissions and project models. If not relevant, completely understand.

— {sender_name}
{sender_role}
F2K Capital
```

### Variant B — Shorter, signal-led (for time-pressed FO principals)

```
Thanks {first_name}. F2K is raising $18.7M senior debt across two AU property
projects — Branscombe (TAS modular construction, $16.2M @ 8.5%) and Seafields
(WA residential land, $2.5M @ 8.0%). Both first-mortgage, wholesale, fixed-term.

{credit_signal} suggested fit. Lenders can take either facility individually
or both. Pari-passu in syndicate, $1-5M tickets typical.

V10 IMs and models available on request. Worth a 20-minute call?

— {sender_name}, F2K Capital
```

### Variant C — Concise + explicit opt-out (for unclear-fit scores 7-8)

```
Thanks for connecting, {first_name}.

F2K is placing senior debt directly with selected lenders into two AU property
projects (Branscombe TAS $16.2M + Seafields WA $2.5M, first-mortgage, 8-8.5%
indicative). {credit_signal} suggested {firm} may be in the market.

If a 20-minute credit conversation would be useful, I can share documentation.
If not aligned or not the right moment, no worries — won't follow up again.

— {sender_name}, F2K Capital
```

## Follow-up DM (7 days after first DM, no reply)

```
{first_name} — short follow-up. If a 20-min call on either of the F2K facilities
(Branscombe $16.2M senior construction, Seafields $2.5M senior land) would be
useful, I can share V10 IMs and credit models. Otherwise no further follow-up.

— {sender_name}
```

---

## ⚠ FORBIDDEN PHRASES (HARD BLOCK in pre-send filter)

These must be rejected by the regex layer. Lender-channel-specific additions on top of standard list:

```
- "guaranteed" / "guarantee"
- "risk-free" / "no risk"
- "outperform" with specific %
- "double-digit returns"
- specific IRR figures beyond indicative rates already in IM (8.5% Branscombe / 8.0% Seafields are pre-approved)
- "exclusive opportunity" / "limited time"
- "act now" / "today only"
- "best in class"
- specific completed-project financial figures we haven't documented
- any reference to the tokenised GREH fund (deferred — per Sec 5.7 only address if asked)
- "retail" anywhere (lenders are wholesale)
- "advisor" / "advise" (this is a credit conversation, not an advisory product)
- "your clients" (the lender IS the principal)
```

## ⚠ SOFT-FLAG PHRASES (LLM-check required, operator approval)

These need an extra LLM pass + operator review:

```
- specific rate numbers beyond IM-quoted (8.5%, 8.0%) — flag any other %
- specific raise amount (anything beyond $16.2M, $2.5M, $18.7M)
- "wholesale" — flag if combined with retail-style framing
- specific past project names not in the V10 IMs
- "Stamford" / "Front Financial" — if mentioned, requires operator confirmation of Sec 5.5 script
- "tokenisation" / "tokenised" / "crypto" / "RWA" — should NOT appear in cold outreach (per Sec 5.7)
- "AFSL" — flag pending counsel sign-off (Sec 5.8)
```

## ✓ SAFE PHRASES

```
- "senior debt facility"
- "first-mortgage"
- "wholesale only"
- "indicative rate"
- "pari-passu"
- "fixed-term"
- "syndicate participation"
- "direct lender process"
- "selected lenders"
- "20-minute credit conversation"
- "V10 Finance Submission"
- "credit model"
- specific project names (Branscombe, Seafields)
- specific GRV / TDC figures from V10 IMs
- specific anchor offtake names (Homes Tasmania, GROH / WA Housing Authority)
- specific co-developer / partner names (Barr Builders, Unison Modular, Humfrey Land Developments)
```

---

## Inbox Agent response scripts (per Sec 5 of brief)

These are NOT cold-message templates — they are scripts the Inbox Agent uses when a lender asks specific questions in reply.

### If asked about Stamford / Front Financial (Sec 5.5)

**Soft framing in cold messages (default — no mention).**

**Direct framing in conversation once engaged:**

> "We engaged broker-led processes (Stamford Capital and Front Financial) to place the combined facility. That process stalled and we're now running directly to lenders we want long relationships with. We'd rather build the syndicate ourselves than wait on a process that's not delivering."

### If asked about the tokenised fund / GREH (Sec 5.7)

> "That platform is a long-term project pipeline vision and is not connected to this senior debt raise. The facilities we're discussing today are conventional first-mortgage development debt, documented and secured in the standard way. The tokenised platform sits behind it as a roadmap item — happy to discuss separately if relevant, but it has no bearing on the credit decision in front of you."

### If asked about junior layer / equity disclosure (Sec 5.6)

**Include in second-touch message proactively:**

> "Project equity already in: Branscombe has $1.6M Barr land equity + $1.155M Barr deferred (in-kind) + $500K confirmed investor cash deposit at M0. Seafields has $200K sponsor advance already injected for Tranche 1 civils. Total equity ahead of any senior debt drawn: $3.455M across the two projects."

### If asked about indicative rate above IM (Sec 5.1)

**Default: hold the IM-quoted rates (8.5% Branscombe, 8.0% Seafields).**

> "The indicative rates in the V10 Finance Submissions are what we're holding to. Subject to credit committee feedback we can discuss structure (term, fee mix) but the rate floor is what's in the IM."

### If asked about lead arranger (Sec 5.2)

**If a lender self-identifies as wanting lead arranger role:**

> "We're open to a lead arranger if it accelerates execution. F2K would coordinate the syndicate otherwise. Let's discuss what structure works for you."

---

## Approval queue UX requirements (Sprint 1 deliverable)

Approval queue card per lender prospect:

```
┌──────────────────────────────────────────────────────────────┐
│ James Wilson — Wilson Capital Partners                       │
│ ICP score: 8.7/10  |  Personalization: 8/10                  │
│ Routed: Combined (large ticket band, FO principal)           │
│                                                              │
│ COMPLIANCE: ● GREEN — no forbidden phrases, no soft flags    │
│             [details ▼]                                      │
│                                                              │
│ CREDIT SIGNAL:                                               │
│   Wilson Capital LinkedIn post 2026-03-15: "Glad to have    │
│   participated in the Pacific Vista BTR facility..."        │
│                                                              │
│ ─── Connection request ───                                   │
│   James — F2K is placing two AU property dev senior debt    │
│   facilities directly with selected lenders...              │
│   [284 chars / 300 limit]                                    │
│                                                              │
│ ─── First DM (queued 24-48h after accept) ───                │
│   Thanks for connecting, James. Short context: F2K is...    │
│   [Includes both facility specifics + indicative rates]      │
│                                                              │
│ [✓ APPROVE & SEND]  [✏ EDIT]  [✗ SKIP]  [⛔ FLAG]           │
└──────────────────────────────────────────────────────────────┘
```

Mobile-friendly. Compliance status colour-coded with expandable reason.

---

## Once counsel signs off

1. Templates loaded into `sequence_templates.steps[].body_template` for the lender-channel sequence.
2. Pre-send filter loads forbidden + soft-flag + safe phrase lists from JSON config.
3. Personalisation scoring is a Sprint 1 deliverable — LLM call per message.
4. Inbox Agent response scripts loaded into the (Phase 3 deferred) inbox classifier OR into the manual approval workflow until Phase 3 ships.
5. Counsel sign-off recorded in `docs/sprint-0/legal-signoff-2026-XX-XX.md` referencing exact template versions approved.
