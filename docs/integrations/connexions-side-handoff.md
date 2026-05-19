# Handoff brief — Connexions outbound intake webhook to InvestorPilot

**For:** the next Connexions session (start a new Claude Code session in `C:\Users\denni\PycharmProjects\Connexions` and paste this entire document as the first message).

**Authored:** 2026-05-19, from InvestorPilot's session at `e024e04`.

**Status:** spec, ready to implement. No code on the Connexions side yet.

---

## The ask

When a prospect completes the `platform-trust-sprint-intake` flow in Connexions, send the captured answers + prospect contact info as a webhook to InvestorPilot. The receiving side (`/api/webhooks/connexions-intake`) is being built in the InvestorPilot repo; this brief is the Connexions-side implementation.

**Why:** InvestorPilot drives cold outreach whose CTA points at the Connexions intake. Today, when a prospect completes the intake, their answers stay in Connexions and InvestorPilot has no idea which partner record converted. This webhook closes the loop so the operator (Dennis) sees each completed intake attached to the prospect on the InvestorPilot side.

**Reversible:** if anything breaks on the InvestorPilot side, Connexions failed webhooks queue and retry (no data loss). If we ever want to kill the integration, just drop the outbound call — Connexions's own data is unaffected.

---

## Contract (this is the binding part — InvestorPilot is implementing the receiver against this exact shape)

### Inbound URL flow (already happening, just needs `?ref` capture)

When InvestorPilot sends cold outreach, the CTA URL it composes is:

```
https://connexions-silk.vercel.app/p/platform-trust-sprint-intake?ref={partner_id}&src=ip-outreach
```

- `ref` — InvestorPilot's `partners.id` UUID for the recipient. Required when sourced from outreach. May be absent for organic / direct traffic.
- `src` — origin marker. `ip-outreach` for InvestorPilot outreach. `organic` when neither param present (set this default on the Connexions side).

**Connexions must capture both at landing time** and persist on the intake-session row, before the prospect answers the first question. If `ref` is absent, persist `null`. If `src` is absent, persist `'organic'`.

You probably have an `intake_sessions` table or equivalent already; add `ref TEXT` and `src TEXT` columns to it via migration.

### Webhook trigger

Fire when the intake reaches `status = 'completed'` (last question submitted, all required answers captured). Fire **once** per intake — not on partial saves, not on resumes. Abandoned intakes do not fire.

### Target URL

```
POST https://investor-pilot-pi.vercel.app/api/webhooks/connexions-intake
```

Make this configurable via env var `INVESTORPILOT_INTAKE_WEBHOOK_URL` so local testing can target `http://localhost:3000/api/webhooks/connexions-intake`.

### Headers

```
Content-Type: application/json
X-Connexions-Signature: sha256=<hex HMAC-SHA256 of raw body, shared secret>
X-Connexions-Event: intake.completed
X-Connexions-Delivery: <fresh UUID per delivery attempt>
```

### Payload (JSON)

```json
{
  "intake_id": "<Connexions's UUID for this intake row — used by InvestorPilot for dedup>",
  "ref": "<partner_id from the landing URL, or null>",
  "src": "ip-outreach | organic | other",
  "intake_slug": "platform-trust-sprint-intake",
  "completed_at": "2026-05-19T14:23:11Z",
  "prospect": {
    "name": "Kelly Nagle",
    "email": "kelly@nagletransport.com.au",
    "company": "Nagle Transport",
    "linkedin_url": "https://www.linkedin.com/in/kelly-nagle/"
  },
  "answers": [
    { "question_id": "what_problem", "question": "What workflow is costing you the most time?", "answer": "Dispatch scheduling for the dangerous-goods runs." },
    { "question_id": "scale", "question": "How many people are affected?", "answer": "Two coordinators full-time on it." }
  ],
  "summary": "Mid-sized AU transport operator with dangerous-goods runs. Two FTEs on dispatch coordination. High intent.",
  "duration_seconds": 247
}
```

Field guidance:

- `intake_id` — Connexions's stable UUID. Used by InvestorPilot as the dedup key (unique index). Never reuse.
- `ref` — preserve EXACTLY as captured from the landing URL. Don't validate, don't lookup, don't filter. Even if it looks malformed, send what you captured.
- `prospect` — best-effort. Empty fields are fine; prefer `null` over `""`. Whatever fields Connexions captures during the intake go here.
- `answers` — ordered array. `question_id` must be stable across intake schema versions (don't rename ids; if you change the intake's question set, version it via a new slug).
- `summary` — optional. If you have a post-intake Claude summariser, include the output here. If not, omit the field entirely.

### Signature

HMAC-SHA256 of the **raw request body** using a shared secret stored in env var `CONNEXIONS_INTAKE_WEBHOOK_SECRET`. Lowercase hex. Header format: `sha256=<hex>` (matches the GitHub / Resend convention so InvestorPilot can reuse existing verify logic).

```ts
import { createHmac } from 'node:crypto';

const rawBody = JSON.stringify(payload);
const signature = 'sha256=' + createHmac('sha256', process.env.CONNEXIONS_INTAKE_WEBHOOK_SECRET!)
  .update(rawBody)
  .digest('hex');

// Then POST rawBody with X-Connexions-Signature: <signature>
```

InvestorPilot returns 401 if signature missing or mismatched. Don't retry on 401 — that's a permanent failure (wrong secret).

### Retry policy

On non-2xx response from InvestorPilot:

- 2xx → success, stop retrying.
- 4xx → permanent failure. Log and mark delivery `failed` in Connexions's delivery log. Do NOT retry (4xx means signature failed, payload malformed, or InvestorPilot rejected the schema — those won't fix themselves).
- 5xx or network error → transient. Retry with exponential backoff: 30s, 2m, 10m, 1h, 6h. After 5 attempts, mark `failed` and surface in Connexions admin.

### Idempotency

Once InvestorPilot returns 2xx for a given `intake_id` + `X-Connexions-Delivery` pair, Connexions must not re-fire that same delivery. InvestorPilot also dedupes on `intake_id` so duplicate sends return 200 OK with no DB write — but Connexions shouldn't rely on that, it's defence-in-depth.

---

## Shared secret

Generate once, store in BOTH projects' Vercel env vars (`production`, `preview`, `development`):

```bash
# Generate a 64-char hex secret:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
# Connexions side — from cd C:\Users\denni\PycharmProjects\Connexions
printf '<the 64-char secret>' | vercel env add CONNEXIONS_INTAKE_WEBHOOK_SECRET production
printf '<same secret>' | vercel env add CONNEXIONS_INTAKE_WEBHOOK_SECRET preview
printf '<same secret>' | vercel env add CONNEXIONS_INTAKE_WEBHOOK_SECRET development
```

**Use `printf`, not `echo`** — `echo`'s trailing newline gets stored verbatim and breaks HMAC compare. This trap has burned Dennis before; it's in his memory at `feedback_vercel_env_printf_not_echo.md`.

After deploying the secret, push the same value to InvestorPilot's Vercel project. Dennis will handle that side from the InvestorPilot session, OR you can do it via `cd ../investorpilot && printf ... | vercel env add ...` if you have multi-project access.

Also add `INVESTORPILOT_INTAKE_WEBHOOK_URL` to Connexions:

```
INVESTORPILOT_INTAKE_WEBHOOK_URL=https://investor-pilot-pi.vercel.app/api/webhooks/connexions-intake
```

---

## Implementation checklist (Connexions side)

Tick these off as you go. Each is intentionally small.

- [ ] **Schema:** Add `ref TEXT NULL` and `src TEXT NOT NULL DEFAULT 'organic'` columns to whatever table tracks intake sessions (likely `intake_sessions` or similar — find it via `grep -r "intake" supabase/migrations/`).
- [ ] **Landing page:** Capture `?ref` and `?src` query params at first load. Persist to the session row. Don't validate `ref` — store whatever's there, even if malformed.
- [ ] **Completion trigger:** Find where intake status transitions to `completed`. Add a post-commit hook that schedules the outbound webhook (don't do it inline — if InvestorPilot is down, you don't want to block the completion).
- [ ] **Outbound HTTP client:** New file, e.g. `lib/webhooks/intake-completed.ts`. Build the payload from the session row + answers. Sign. POST. Handle retries (exponential backoff, max 5 attempts).
- [ ] **Delivery log:** Persist each delivery attempt to a `webhook_deliveries` table (or similar) with: `intake_id`, `target_url`, `attempt_number`, `status_code`, `response_body_excerpt`, `delivered_at`. Operator can see what went out, what came back.
- [ ] **Env vars:** `CONNEXIONS_INTAKE_WEBHOOK_SECRET`, `INVESTORPILOT_INTAKE_WEBHOOK_URL` deployed across production / preview / development.
- [ ] **Admin surface (optional v1):** A `/admin/webhook-deliveries` page where Dennis can see failed deliveries and click "re-fire". Defer if scope-pressed; he can run SQL by hand for v1.
- [ ] **Test plan:** see below.

---

## Test plan

Before merging to main on the Connexions side:

1. **Local end-to-end.** Run InvestorPilot locally on port 3000 (`pnpm dev` in `C:\Users\denni\PycharmProjects\investorpilot`). Set `INVESTORPILOT_INTAKE_WEBHOOK_URL=http://localhost:3000/api/webhooks/connexions-intake` in Connexions's `.env.local`. Complete a test intake. Confirm InvestorPilot logs `[webhooks/connexions-intake] received intake_id=...` and the operator sees the response on a partner card.

2. **Signature failure.** Temporarily change `CONNEXIONS_INTAKE_WEBHOOK_SECRET` on the Connexions side only. Complete an intake. Confirm InvestorPilot returns 401, no row written, no infinite retry (Connexions stops on 4xx).

3. **Idempotency.** Manually re-fire the same delivery (with the same `X-Connexions-Delivery` UUID). Confirm InvestorPilot returns 200 with no second DB row.

4. **Organic intake (no `ref`).** Navigate directly to `connexions-silk.vercel.app/p/platform-trust-sprint-intake` (no query params). Complete the intake. Confirm the webhook fires with `ref: null, src: "organic"` and InvestorPilot writes the row with `partner_id = null` — these unattributed intakes still need to surface somewhere (admin view).

5. **Production smoke test.** Deploy Connexions to production. Have Dennis send one real cold outreach, click the CTA himself, complete the intake. Confirm the response shows on the partner card in InvestorPilot within 30 seconds.

---

## What InvestorPilot is building in parallel

So you know what's happening on the other side of this contract:

- `POST /api/webhooks/connexions-intake` route with signature verify, idempotency on `intake_id`, insert into new `intake_responses` table.
- `intake_responses` table migration (UUID PK, `external_intake_id` UNIQUE, FK to `partners` nullable, raw payload preserved for audit).
- Middleware allowlist for the new webhook route (InvestorPilot's middleware blocks auth on `/api/*` by default; webhooks need explicit allowlist).
- CTA URL generation in the renderer now appends `?ref=<partner.id>&src=ip-outreach` to the intake URL.
- Operator surface: intake responses render on the partner detail card with answers expandable + summary at top.

You don't need to do anything to coordinate that work — the contract above is the binding interface. If InvestorPilot needs to change anything in the payload shape, that'll come back as a doc update before either side ships.

---

## Acceptance criteria

Connexions's job is done when:

1. A test intake with `?ref=<some-uuid>` lands a row in InvestorPilot's `intake_responses` table with the matching `external_intake_id` and `partner_id` resolved.
2. Signature verification works (401 on bad secret).
3. Retries fire correctly on 5xx (verifiable by tailing Connexions's webhook_deliveries table during a forced outage).
4. Organic intakes (no `ref`) still deliver, with `partner_id = null` on the InvestorPilot side.
5. No backwards-compatibility breakage — existing intake flow (without webhook) still works if the env vars aren't set (don't hard-fail when `CONNEXIONS_INTAKE_WEBHOOK_SECRET` is missing in dev; log a warning and skip).

---

## Out of scope for v1

- Voice intakes (ElevenLabs route). Same contract should work but the `intake_slug` differs. Defer.
- Click tracking on the CTA URL itself (separate from completion). Different mechanism, different value.
- Multi-tenant Connexions. Current Connexions serves one InvestorPilot org; revisit if that changes.
- Operator-facing replay UI inside Connexions admin. SQL-level replay is fine for v1.

---

## Reference

The full integration spec lives at `docs/integrations/connexions-intake-webhook.md` in the InvestorPilot repo. This handoff is the implementer's brief; the spec is the source of truth.
