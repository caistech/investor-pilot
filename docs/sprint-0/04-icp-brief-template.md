# Sprint 0 — ICP Brief (Template) [SUPERSEDED]

# ⚠ SUPERSEDED by Senior Debt Brief v3 — see `11-senior-debt-brief-v3.pdf` and `09-f2k-best-fit-profile-DRAFT.md` (v3)

**This template was built for the advisor-channel ICP (v1/v2 framing).** The Senior Debt Brief v3 (signed off by Uwe, 13 May 2026) pivots the channel target to direct lenders — see Section 4 of the PDF for the operational lender ICP. File 09 v3 mirrors that ICP operationally.

This file is retained for historical reference only — DO NOT use it to drive discovery, scoring, or message generation. If the advisor channel is re-opened in a future phase, this template would need a v2 update to reflect lessons from the lender-channel build.

---

**[Original content below preserved for reference]**

**Purpose:** Convert "Australian advisor serving sophisticated investors" from a placeholder into a precise, testable ICP that drives the discovery prompt, scoring weights, and 20-target truth set.

**Audience:** Dennis + Uwe to complete together. Drive to written sign-off.

**Once complete:** This document gates Sprint 1 sends. Discovery prompt and scoring rubric are updated to match before any code lands.

---

## Section 1 — Decision authority and timing

| Field | Value |
|---|---|
| ICP owner (final decision) | _____________________ |
| Reviewers (sign-off) | _____________________ |
| Date drafted | _____________________ |
| Date signed off | _____________________ |
| Review cadence (re-validate every N weeks) | _____________________ |

## Section 2 — Job title precision

The discovery prompt currently uses "principal advisor / investment director / managing director." Tighten this with explicit accepts and rejects.

**Accept these titles (the LLM scoring rubric will treat as ICP):**
- [ ] _____________________
- [ ] _____________________
- [ ] _____________________
- [ ] _____________________
- [ ] _____________________

**Reject these titles (the LLM should down-score or skip):**
- [ ] Associate adviser / paraplanner / junior adviser — too junior to refer
- [ ] _____________________
- [ ] _____________________
- [ ] _____________________

**Edge cases (case-by-case):**
- [ ] Principal advisor at multi-principal firm — only the lead?
- [ ] _____________________

## Section 3 — Firm criteria

### AUM under advice

- Minimum AUM threshold: $_____________________
- Why this threshold? _____________________
- How will we verify AUM in scoring? (LinkedIn bio, ADV form, firm website, Hunter enrichment data) _____________________

### AFSL status

- Firm must hold current AFSL? (Y/N) _____________________
- If advisor is a sub-authorized rep under a separate AFSL holder, accept? (Y/N) _____________________
- How to verify? (ASIC register lookup, firm website disclosure) _____________________

### Firm type

Check all that apply:
- [ ] Independent wealth management firm
- [ ] Bank-owned wealth division (e.g., MLC, BT, Macquarie Private Wealth)
- [ ] Family office (single-family)
- [ ] Family office (multi-family / MFO)
- [ ] SMSF administrator / specialist
- [ ] Boutique advisory (1-5 advisors)
- [ ] Stockbroker with advisory wing
- [ ] Other: _____________________

### Geographic scope

- [ ] Australia-wide
- [ ] Specific states only: _____________________
- [ ] Specific metros only: _____________________
- Reason for any geo restrictions: _____________________

## Section 4 — Client base criteria

### Sophistication

The advisor's clients must qualify as:
- [ ] s708(8) Sophisticated Investor (net assets >$2.5M OR income >$250K for 2 consecutive years)
- [ ] s761G Wholesale Client (chief executive officer of a body corporate that is a wholesale client, or net assets >$10M)
- [ ] Both
- [ ] Either

**Evidence of sophistication client base:** how will we infer this from public data?
- [ ] Firm publishes client AUM averages / case studies
- [ ] Firm's marketing positions explicitly to HNW / UHNW / wholesale
- [ ] Firm holds events / writes content for sophisticated investor segment
- [ ] LinkedIn bio mentions "private wealth" / "family office" / "wholesale clients" / similar
- [ ] Other signal: _____________________

### Alternative investment history

- [ ] Has placed clients into property syndicates / unlisted property funds
- [ ] Has placed clients into private credit / direct lending
- [ ] Has placed clients into private equity / VC
- [ ] Has placed clients into alternative real assets (timber, infrastructure, etc.)
- [ ] Currently allocates to alternatives in model portfolios

How to detect alternative-investment history?
- Firm marketing material / case studies
- Advisor's LinkedIn content / posts mentioning alts
- ASIC AFSL authorizations include relevant product categories
- Other: _____________________

## Section 5 — Exclusions (do not waste cycles)

**Do NOT discover or score these:**
- [ ] Robo-advice platforms (Stockspot, Six Park, etc.)
- [ ] Large banks' general retail advice channels
- [ ] Mortgage brokers (not investment advisors)
- [ ] Accounting firms without advisory licensing
- [ ] Insurance-only advisors
- [ ] _____________________
- [ ] _____________________

## Section 6 — Scoring weight calibration (against D5 decision)

Decision D5 set weights to: Client Quality 35%, Alt-History 25%, Reachability 20%, Regulatory Standing 15%, Geographic Fit 5%.

Confirm these per the precise ICP defined above:
- [ ] Weights as set in D5
- [ ] Modify: _____________________

For each dimension, what would a **10/10 score** look like for this ICP?

**Client Quality (35%) — 10/10 description:**
> Example: "Firm explicitly markets to HNW / UHNW with $2M+ AUM minimum per client, publishes case studies of sophisticated investors, has dedicated 'private wealth' or 'family office' brand."
> Your version:
> _____________________

**Alt-Investment History (25%) — 10/10 description:**
> _____________________

**Reachability (20%) — 10/10 description:**
> _____________________

**Regulatory Standing (15%) — 10/10 description:**
> _____________________

**Geographic Fit (5%) — 10/10 description:**
> _____________________

## Section 7 — Truth set: 20 "perfect-fit" advisors

This is the gold standard for the discovery prompt + scoring. The LLM should score these advisors 8-10 on the rubric. Any LLM run that scores <8 on these is mis-tuned.

| # | Advisor name | Firm | Title | LinkedIn URL | Why ICP | Expected score |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |
| 11 | | | | | | |
| 12 | | | | | | |
| 13 | | | | | | |
| 14 | | | | | | |
| 15 | | | | | | |
| 16 | | | | | | |
| 17 | | | | | | |
| 18 | | | | | | |
| 19 | | | | | | |
| 20 | | | | | | |

Of these 20, mark with a (★) the 5 highest-priority targets for Sprint 1's 10-prospect cohort.

## Section 8 — Negative truth set: 5 "looks like ICP but isn't" cases

For LLM tuning, also list 5 advisors who look superficially like ICP but should NOT be high-scoring.

| # | Advisor / firm | Why they look ICP | Why they're NOT ICP |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

## Section 9 — Sign-off

- [ ] Dennis: ICP definition accurately reflects F2K's target advisor.
- [ ] Uwe: ICP aligns with F2K Housing Development Fund's intended distribution channel and AFSL posture.
- [ ] Truth set of 20 advisors compiled and consistent with definition.
- [ ] Negative truth set of 5 compiled.
- [ ] No internal contradictions between job titles, firm criteria, and client-base criteria.
- [ ] Geographic scope agreed.

Dennis signature / date: _____________________

Uwe signature / date: _____________________

---

## Once signed off

1. Update `src/app/api/pipeline/discover/route.ts` prompt with new ICP language and accept/reject lists.
2. Update scoring rubric (5 dimensions with new 10/10 descriptions).
3. Re-score the 5-prospect truth set; verify scores are 8-10.
4. Re-run any previously discovered prospects against new rubric; flag any whose score drops by >2 points (they were mis-scored before).
5. Update INVESTOR_PILOT_AGENTIC_PLAN.md "Placeholder ICP" section to "Validated ICP" with date.
