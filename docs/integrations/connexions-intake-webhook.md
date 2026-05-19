# Connexions → InvestorPilot intake webhook

**Status:** spec, not yet implemented
**Authored:** 2026-05-19
**Owner:** Dennis (operator), implemented across two repos

## Why this exists

InvestorPilot's outreach pipeline sends cold messages whose CTA points at a Connexions-hosted intake URL (`https://connexions-silk.vercel.app/p/platform-trust-sprint-intake`). When a prospect clicks through and completes the intake on Connexions, their answers stay in Connexions and never link back to the partner record in InvestorPilot that triggered the click. That breaks two loops:

1. **Operator visibility.** Dennis can't see "Kelly at Nagle Transport completed the intake" inside InvestorPilot — he has to switch to Connexions and manually correlate. Across 50+ prospects per campaign, the correlation cost is real.
2. **Conversion tracking.** No way to attribute completed intakes to specific outbound messages → can't measure which sequences convert, which subject lines pull, which verticals close.

Fix: Connexions emits a webhook on intake completion. InvestorPilot receives, dedupes, signature-verifies, and attaches the response to the originating partner record.

## Why not "build a native intake in InvestorPilot"

Considered and rejected on 2026-05-19. Connexions's intake works today, has voice + text question logic Dennis has already tuned, and is the front door across multiple Corporate AI Solutions products. Rebuilding it inside InvestorPilot would force a parallel maintenance burden for marginal end-to-end-ownership gain. The webhook is the lighter, reversible step.

## Contract

### URL flow

Outreach CTA URL (InvestorPilot composes this when generating the outbound message body):

```
https://connexions-silk.vercel.app/p/platform-trust-sprint-intake?ref={partner_id}&src=ip-outreach
```

- `ref` — the InvestorPilot `partners.id` (UUID) of the recipient. Required when sourced from outreach. May be empty for organic / direct traffic.
- `src` — origin marker. `ip-outreach` for InvestorPilot-driven traffic. Lets Connexions route the webhook only when the visit came from outreach, not from organic / unrelated traffic.

Connexions persists `ref` and `src` on the intake-session row at landing time, before the prospect answers the first question. If the landing URL has no `ref` (organic visit), persist `ref = null` and `src = 'organic'`.

### Webhook trigger

Fire when the intake reaches `status = 'completed'` (last question submitted, all required answers captured). Fire **once** per intake — not on partial saves, not on resumes.

If the intake is abandoned (no completion event within 7 days, or operator manually marks it abandoned), no webhook fires. We track only completed intakes.

### Webhook target

```
POST https://investor-pilot-pi.vercel.app/api/webhooks/connexions-intake
```

(Configurable via env var `INVESTORPILOT_INTAKE_WEBHOOK_URL` on the Connexions side so test deployments can target a staging URL.)

### Headers

```
Content-Type: application/json
X-Connexions-Signature: <hex HMAC-SHA256 of raw body, shared secret>
X-Connexions-Event: intake.completed
X-Connexions-Delivery: <uuid, unique per attempt — InvestorPilot uses for replay protection>
```

### Payload

```json
{
  "intake_id": "<Connexions's UUID for this intake row>",
  "ref": "<partner_id from landing URL, or null if organic>",
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
    { "question_id": "scale", "question": "How many people are affected?", "answer": "Two coordinators full-time on it." },
    { "question_id": "tried", "question": "What have you tried?", "answer": "Built spreadsheets, hired a part-time dispatcher, neither stuck." }
  ],
  "summary": "Mid-sized AU transport operator with dangerous-goods runs. Two FTEs on dispatch coordination. Spreadsheets and manual hire didn't solve. High intent.",
  "duration_seconds": 247
}
```

Field guidance:

- `intake_id` — required, used by InvestorPilot for dedup (unique index). Never reuse.
- `ref` — preserve exactly as passed in landing URL. Don't lookup, validate, or filter. InvestorPilot resolves it against `partners.id`.
- `prospect` — best-effort. Empty fields OK; `null` is preferred over `""`.
- `answers` — ordered array. `question_id` must be stable across intake schema versions so InvestorPilot can join historical responses.
- `summary` — optional. If Connexions has a Claude-driven post-intake summariser, include it. If not, omit.

### Signature

HMAC-SHA256 of the raw request body using the shared secret in env var `CONNEXIONS_INTAKE_WEBHOOK_SECRET`. Lowercase hex. Place in `X-Connexions-Signature` as `sha256=<hex>` (mirror GitHub / Resend pattern).

```ts
import { createHmac } from 'node:crypto';
const sig = 'sha256=' + createHmac('sha256', process.env.CONNEXIONS_INTAKE_WEBHOOK_SECRET).update(rawBody).digest('hex');
```

InvestorPilot rejects with 401 if the signature header is missing OR doesn't match the body. Required: timing-safe comparison.

### Retry policy

On non-2xx response from InvestorPilot, retry with exponential backoff: 30s, 2m, 10m, 1h, 6h. After 5 failed attempts, mark the delivery `failed` in Connexions and surface in the Connexions admin (operator manually re-fires if needed). Do not retry on 4xx — those indicate signature failures or malformed payloads that won't fix themselves.

### Idempotency

Connexions must guarantee the same `intake_id` + `X-Connexions-Delivery` UUID pair is never re-sent within a successful chain (i.e. once InvestorPilot 200s, Connexions stops retrying that delivery). InvestorPilot uses `intake_id` as a unique index — duplicate intake_ids return 200 OK with no DB write.

## Shared secret

Generate once, store in both projects' env vars:

```
CONNEXIONS_INTAKE_WEBHOOK_SECRET=<random 64-char hex>
```

- **InvestorPilot** — Vercel env vars (production + preview + development). `corporate-ai-solutions` team scope, `investor-pilot` project.
- **Connexions** — Vercel env vars on the Connexions project.

Use `printf` not `echo` when piping into `vercel env add` (echo's trailing newline gets stored verbatim and breaks the HMAC compare — see `memory/feedback_vercel_env_printf_not_echo.md`).

## Test plan

Before shipping to production:

1. **Connexions side, local:**
   - Set `CONNEXIONS_INTAKE_WEBHOOK_SECRET` in `.env.local`.
   - Run a test intake against `INVESTORPILOT_INTAKE_WEBHOOK_URL=http://localhost:3000/api/webhooks/connexions-intake` (run InvestorPilot locally too).
   - Confirm InvestorPilot logs `[webhooks/connexions-intake] received intake_id=...` and writes a row to `intake_responses`.
2. **Signature failure:**
   - Send with wrong secret. Confirm InvestorPilot returns 401, no row written.
3. **Idempotency:**
   - Send the same payload twice (same `intake_id`). Confirm InvestorPilot returns 200 both times, only one row in `intake_responses`.
4. **Missing ref (organic intake):**
   - Send with `ref: null`. Confirm InvestorPilot writes the row with `partner_id = NULL` — operator can review unattributed intakes in a dashboard later.
5. **Production smoke:**
   - One real intake from Connexions production → InvestorPilot production. Confirm the response shows on the partner card in `/prospects` within 30 seconds of submit.

## Implementation checklist

### Connexions side (`C:\Users\denni\PycharmProjects\Connexions`)

- [ ] Add `?ref` and `?src` query-param capture on the intake landing page; persist to `intake_sessions.ref` / `intake_sessions.src` (or equivalent).
- [ ] Add `intake_completed` event firing once per intake when status transitions to `completed`.
- [ ] Build outbound HTTP client with HMAC-SHA256 signing, retry-on-failure, exponential backoff, max 5 attempts.
- [ ] Add env vars: `CONNEXIONS_INTAKE_WEBHOOK_SECRET`, `INVESTORPILOT_INTAKE_WEBHOOK_URL` (default `https://investor-pilot-pi.vercel.app/api/webhooks/connexions-intake`).
- [ ] Wire delivery log so failed webhooks are visible in the Connexions admin.
- [ ] Test against local InvestorPilot before going to prod.

### InvestorPilot side (`C:\Users\denni\PycharmProjects\investorpilot`)

- [ ] Migration: `intake_responses` table (see schema below). RLS enabled, read policy by org.
- [ ] Route: `POST /api/webhooks/connexions-intake`. Signature verify, idempotency check on `intake_id`, insert row.
- [ ] Middleware allowlist: add `/api/webhooks/connexions-intake` to the public-routes list in `middleware.ts` (per `feedback_middleware_allowlist_pattern.md` — this trap has bitten us before).
- [ ] CTA URL generation in `src/lib/sequencer/render-llm.ts` (and any other places the intake URL is referenced): append `?ref=<partner.id>&src=ip-outreach`. Probably needs the partner_id to be threaded into the render call (it's already available in `partner.id`).
- [ ] Operator surface: render intake responses on the partner detail card (`/prospects/[id]` or wherever the partner card lives) with: completion timestamp, prospect contact info, expandable answers, summary.
- [ ] Env var: `CONNEXIONS_INTAKE_WEBHOOK_SECRET` deployed to Vercel.

### Migration sketch (InvestorPilot)

```sql
CREATE TABLE IF NOT EXISTS intake_responses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  partner_id           UUID REFERENCES partners(id) ON DELETE SET NULL,
  external_intake_id   TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'connexions',
  intake_slug          TEXT,
  src_param            TEXT,
  completed_at         TIMESTAMPTZ,
  prospect_name        TEXT,
  prospect_email       TEXT,
  prospect_company     TEXT,
  prospect_linkedin    TEXT,
  answers              JSONB,
  summary              TEXT,
  duration_seconds     INTEGER,
  raw_payload          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX intake_responses_external_idx
  ON intake_responses(external_intake_id);
CREATE INDEX intake_responses_partner_idx
  ON intake_responses(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX intake_responses_org_completed_idx
  ON intake_responses(organisation_id, completed_at DESC);

ALTER TABLE intake_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY intake_responses_read_own_org ON intake_responses FOR SELECT
  USING (
    organisation_id IN (
      SELECT active_organisation_id FROM profiles WHERE id = auth.uid()
      UNION
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- No insert / update / delete policies — only the service-role client
-- (running inside the webhook handler) writes rows.
```

### Resolving `ref` to a partner

Webhook handler reads the `ref` field. If non-null and a valid UUID:

```ts
const { data: partner } = await db.from('partners')
  .select('id, organisation_id')
  .eq('id', ref)
  .maybeSingle();
```

If found: write `partner_id = partner.id` and `organisation_id = partner.organisation_id`.
If not found (stale ref, deleted partner): write `partner_id = null` but use the `src` param + headers to infer org if possible. Worst case, write with `organisation_id` null and surface in an admin "unattributable intakes" view.

## Open questions

- **Voice intakes** — Connexions also runs voice (ElevenLabs) intakes. Same webhook contract, different `intake_slug`? Or a separate `intake.completed.voice` event? Defer until voice intakes are actually live for this product.
- **Partial intakes** — should there be a separate `intake.abandoned` event after 7 days of inactivity, so operator can see "Kelly opened but didn't finish"? Useful but not v1.
- **Operator-driven re-send** — if an intake's webhook delivery fails permanently, should there be a "re-send to InvestorPilot" button in Connexions admin? Probably yes, but v1 can be SQL-level operator action.

## Out of scope for v1

- Click tracking on the URL itself (separate from intake completion).
- Native InvestorPilot intake (rejected; see "Why not" above).
- Multi-org Connexions tenancy (one Connexions instance serves all InvestorPilot orgs today; revisit if that changes).
