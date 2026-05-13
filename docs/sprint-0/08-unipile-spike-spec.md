# Sprint 0 — Unipile Capability Spike (Spec)

**Purpose:** Validate Unipile is fit-for-purpose for InvestorPilot Phase 1-2 BEFORE committing to it in Sprint 1. Time-boxed: ~half-day of Dennis's effort + ~€0 (free trial).

**Owner:** Dennis
**Status:** Spec ready to execute.
**Updated 2026-05-13:** Tests 3.11-3.13 added for LinkedIn search (the primary discovery engine — see doc 12 for architectural rationale).

---

## 1. Spike objective

Answer "yes / no / conditional" to the question: **Does Unipile meet InvestorPilot's Phase 1 LinkedIn + email outreach requirements safely enough to proceed?**

If yes: commit, build the wrapper layer in Sprint 1.
If no: pivot to HeyReach + Nylas alternative (research already in doc 03).
If conditional: document what needs to be true and re-spike after.

---

## 2. Setup (30 minutes)

### 2.1 Account provisioning

- [ ] Sign up for Unipile free trial at https://www.unipile.com (no credit card, 7 days).
- [ ] Confirm trial includes all features (LinkedIn + Gmail + webhooks). If gated, capture screenshot of what's missing.
- [ ] Note: trial → paid conversion in 7 days, so plan spike start such that all tests fit in window.

### 2.2 Test account selection

**Critical decision:** which LinkedIn account is connected for the spike?

Options:
- **A) Dennis's primary LinkedIn account** — realistic but **puts the actual operator account at risk during a spike**. Not recommended.
- **B) A throwaway LinkedIn account** — safer but LinkedIn detects fresh accounts and behaves differently (sees fewer connections, different rate limits, may flag as suspicious sooner). Less realistic.
- **C) A secondary professional account Dennis owns (if any)** — best of both.

**Recommended:** B (throwaway) for capability testing; if all green, repeat critical tests once on A (Dennis's real account) with 1-2 outbound actions only, as final validation.

- [ ] Test account chosen: _____________________
- [ ] If throwaway: account has been "aged" for at least 2 weeks (real-looking profile photo, headline, some connections) — see [LinkedIn warmup best practice](https://www.linkedin.com/help/linkedin/answer/119991)

### 2.3 Email test account

- [ ] Connect a test Gmail account (must NOT be a real F2K account during spike).
- [ ] Verify OAuth flow completes via Unipile's hosted auth page.
- [ ] Confirm Unipile dashboard shows the email account as "active."

---

## 3. Test cases (3 hours)

For each test: record the API request, response, latency, and any errors. Pass / fail criteria per test.

### Test 3.1 — Send a LinkedIn connection request with note

- [ ] Use Unipile `POST /chats` (or invitation-specific endpoint) to send 1 connection request to a test recipient (use an account Dennis controls to receive).
- [ ] Capture: API latency, response body shape, message_id.
- **PASS:** Connection request arrives at recipient inbox within 30 seconds.
- **FAIL:** No request received, error code returned, or latency >2 minutes (unusable for sync UX).

Notes: _____________________

### Test 3.2 — Webhook fires when connection is accepted

- [ ] Configure webhook endpoint in Unipile dashboard pointing to a temporary ngrok / Vercel preview URL.
- [ ] On recipient account, accept the connection request from Test 3.1.
- [ ] Capture: webhook payload, latency between accept and webhook fire, payload shape.
- **PASS:** Webhook fires within 5 minutes of acceptance; payload includes prospect ID + acceptance timestamp.
- **FAIL:** No webhook, late by >15 minutes (breaks the "send DM after accept" sequence design), or payload missing critical fields.

Notes: _____________________

### Test 3.3 — Send a LinkedIn DM after connection accepted

- [ ] Use Unipile message endpoint to send a DM to the now-connected test account.
- [ ] Capture: latency, response shape.
- **PASS:** DM arrives within 30 seconds.
- **FAIL:** Error code, latency >2 minutes, or rate-limit message.

Notes: _____________________

### Test 3.4 — Webhook fires when DM reply received

- [ ] Recipient replies to the DM.
- [ ] Capture: webhook payload, latency.
- **PASS:** Webhook fires within 5 minutes with full reply content.
- **FAIL:** No webhook or content truncated.

Notes: _____________________

### Test 3.5 — Send an email from connected Gmail

- [ ] Use Unipile email send endpoint to send a test email.
- [ ] Capture: latency, response, message ID; check the email arrives in recipient inbox.
- **PASS:** Email delivered within 30 seconds, no spam folder.
- **FAIL:** Spam folder, delivery failure, latency >2 minutes.

Notes: _____________________

### Test 3.6 — Daily cap behavior

- [ ] Send 25 connection requests from the test account in a single day (above LinkedIn's typical 20-25/day soft cap).
- [ ] Document what happens at request 21, 22, 23...
  - Does Unipile pre-empt the call and reject?
  - Does LinkedIn return a rate-limit response?
  - Does the request silently fail?
  - Is there a captcha challenge?
- **CRITICAL FINDING:** Unipile's behavior at cap limit determines how InvestorPilot's middleware needs to gate.

Notes (verbatim of what happens): _____________________

### Test 3.7 — Account-health webhook / signal

- [ ] If a captcha or login challenge was triggered in Test 3.6, capture what Unipile reports.
- [ ] Look for "account status" webhooks in dashboard config and trigger one if possible.
- **PASS:** Unipile fires an account-health webhook with status='paused' or 'flagged' or similar.
- **FAIL:** No automatic signal; we must poll account status manually (worse, but workable).

Notes: _____________________

### Test 3.8 — Programmatic pause and resume

- [ ] Use Unipile API to pause the account (look for endpoint or dashboard toggle).
- [ ] Confirm no further sends succeed while paused.
- [ ] Resume.
- **PASS:** Pause is immediate (no in-flight sends after pause API returns 200).
- **FAIL:** Pause has a delay or doesn't stop in-flight messages — affects kill-switch design.

Notes: _____________________

### Test 3.9 — Calendar integration (deferred Phase 4 prep)

- [ ] Connect Google Calendar via Unipile OAuth.
- [ ] Query available slots via API.
- [ ] Create a test calendar event.
- **PASS:** Slots returned within 5 seconds; event created in Google Calendar within 30 seconds.
- **FAIL:** Either operation fails or latency > 1 minute.

Notes: _____________________

### Test 3.10 — Support response

- [ ] Submit a low-tier support ticket (e.g., "what's the actual daily cap for LinkedIn?").
- [ ] Note time to first human response.
- **PASS:** Response within 24h.
- **FAIL:** Response >72h or only bot/no response.

Notes: _____________________

### Test 3.11 — LinkedIn people search (PRIMARY discovery engine)

Added 2026-05-13 after the LinkedIn-as-primary-engine clarification — see doc 12 for architectural rationale.

- [ ] Call Unipile's LinkedIn search endpoint with `api: 'classic', category: 'people'` and a keyword query (e.g. "family office private debt Sydney").
- [ ] Capture: full request shape used, full response shape, observed field names for `public_id`, `profile_url`, `full_name`, `headline`, `location`, `current_company`.
- [ ] Confirm `searchLinkedInPeople` in `src/lib/channels/unipile.ts` normalises the response correctly (compare to the `normaliseLinkedInPerson` field map).
- [ ] If field names differ, document the actual shape and update the normaliser.
- **PASS:** Endpoint returns ≥10 results matching the query; profile URLs are valid; latency <5 seconds.
- **FAIL:** Endpoint 404s, returns 0 results for an obviously-populated query, or response shape diverges enough that the normaliser produces empty hits.

Notes: _____________________

### Test 3.12 — Sales Navigator search

- [ ] If connected LinkedIn account has Sales Navigator, call the search endpoint with `api: 'sales_navigator'` plus a `seniority` filter.
- [ ] Capture: how the seniority / function / years-in-position filters map onto Unipile's request body.
- [ ] If no Sales Nav subscription, confirm endpoint returns a 403 with a recognisable error string (the wrapper assumes `/sales[_ -]?nav/i` matches).
- **PASS:** Filtered query returns higher-quality results than the classic API on the same keywords; subscription error is detectable.
- **FAIL:** Sales Nav endpoint missing entirely, or no way to distinguish "no SN" from "general 403".

Notes: _____________________

### Test 3.13 — Search rate-limit behaviour

- [ ] Issue 50 LinkedIn search calls in rapid succession from the same connected account.
- [ ] Document: at what request number does latency spike, 429 appear, or LinkedIn return fewer/empty results?
- [ ] Is there a per-day search cap distinct from the send cap?
- **CRITICAL FINDING:** This determines whether channel-guard needs a separate search cap. Currently channel-guard only gates sends. If a daily search cap exists, add a `search_count` + `search_cap_reset_at` field to `client_channels` and gate before each search.

Notes (verbatim of what happens): _____________________

---

## 4. Decision matrix

Score each test pass / fail / conditional. Use:

| Test | Pass | Fail | Conditional notes |
|---|---|---|---|
| 3.1 LinkedIn connect | | | |
| 3.2 Accept webhook | | | |
| 3.3 LinkedIn DM | | | |
| 3.4 Reply webhook | | | |
| 3.5 Email send | | | |
| 3.6 Daily cap behavior | | | |
| 3.7 Account-health signal | | | |
| 3.8 Pause / resume | | | |
| 3.9 Calendar | | | |
| 3.10 Support response | | | |
| 3.11 LinkedIn people search | | | |
| 3.12 Sales Navigator search | | | |
| 3.13 Search rate-limit | | | |

### Pass criteria for commit

- [ ] Tests 3.1, 3.2, 3.3, 3.4, 3.5 all PASS (the critical Phase 1 send paths)
- [ ] **Test 3.11 PASSes** (LinkedIn people search — this is the primary discovery engine; without it the whole methodology is blocked)
- [ ] Test 3.6 produces clear, documentable send-cap behavior (PASS or workable CONDITIONAL)
- [ ] Test 3.13 produces clear, documentable search-cap behavior (PASS or workable CONDITIONAL)
- [ ] Test 3.8 PASSes (kill-switch viable)
- [ ] At least one of 3.7 or 3.10 PASSes (we can detect account problems)
- [ ] Test 3.12 PASS or CONDITIONAL (Sales Nav nice-to-have, not blocking)

### Fail criteria → abort

- Test 3.1 or 3.3 (the core LinkedIn send) FAILs
- **Test 3.11 FAILs** (LinkedIn people search) — discovery cannot fall back to Brave-only without surrendering the methodology
- Test 3.6 reveals Unipile silently violates LinkedIn caps (we cannot trust the vendor)
- Test 3.8 FAILs (no kill switch)

### Conditional path

If only tests 3.7 and 3.10 fail, Unipile is still viable but InvestorPilot must:
- Poll account status every 5 minutes server-side
- Treat support as unreliable; build internal runbooks for common issues

---

## 5. Final spike report

After all tests complete, Dennis writes a 1-page report:

```
UNIPILE SPIKE REPORT — {date}

Verdict: COMMIT / ABORT / CONDITIONAL-COMMIT

Test results summary:
  Pass: __/10
  Fail: __/10

Critical findings:
  1. ...
  2. ...

Decision: ...

If commit: any constraints on the InvestorPilot wrapper design?
  - Cap behavior at limit: __________
  - Webhook reliability: __________
  - Account pause / resume guarantees: __________

If abort: trigger HeyReach + Nylas evaluation (doc 03).

If conditional: list the conditions that must be true. Re-spike after.
```

Save to `docs/sprint-0/08-unipile-spike-report.md`.

---

## 6. Estimated effort and cost

| Item | Effort | Cost |
|---|---|---|
| Account provisioning | 30min | €0 (free trial) |
| Test account warmup (if throwaway needed) | 1-2 weeks (background) | €0 |
| Test execution | 3 hours | €0 |
| Report writing | 30min | €0 |
| **Total active time** | **~4 hours** | **€0** |

Trial allows 7 days. If spike completes well within trial, no payment required. If we decide to commit, sign up for paid €49/month tier immediately after spike report.
