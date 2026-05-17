# InvestorPilot — Project Status

Last updated: 2026-05-18 AEST (end of day — includes teams iteration)

## Current State

Live on https://investor-pilot-pi.vercel.app/. Forked from PartnerPilot for
F2K Housing Development Fund — sourcing sophisticated/wholesale investors
(s708(8) Corporations Act). Dual-mode: **Projects** (fundraising — investors)
and **Products** (sales — channel partners), both first-class peers with
shared infrastructure and dedicated tone. **Multi-tenant teams** with
per-member channels live as of 2026-05-18.

### What works (operator-facing)

- **Discovery + scoring** — Brave web search + LinkedIn 1st/2nd-degree
  (via Unipile), scored on 5 ICP dimensions, evidence linked back
- **Enrichment** — Hunter.io email finder, LinkedIn profile pull
- **Sequencer** — 6-step LinkedIn + email cadence, tier-modulated tone
  (confident / qualified / exploratory), courtesy contract enforced,
  value-offer DNA, signature handling, render-now concurrency
- **Auto-localisation** — 14 languages (Vietnamese, Korean, Japanese,
  Chinese, Thai, Indonesian, Arabic, Brazilian Portuguese, Spanish,
  French, German, Italian, Turkish, Russian) at render time, English
  original preserved in evidence_refs, one-click toggle in /approvals
- **Approvals queue** — pending/blocked drafts visible org-wide, tier
  and language badges in card headers, prominent English-version toggle
  for translated drafts
- **Send + track** — Resend for email (verified sender
  `noreply@updates.corporateaisolutions.com`), Unipile for LinkedIn,
  outreach_log + outbound_messages persist message IDs
- **Resend webhook** at `/api/webhooks/resend` — bounce/complaint/
  delivery-delayed handling with svix signature validation (operator
  must configure endpoint URL + signing secret in Resend dashboard
  before this is reachable)
- **Pool Summary** — one-page auto-generated deliverable per project
  and product. Surfaced as headline chips on list rows, featured cards
  on the dashboard, and cross-linked from every partner detail page.
  Print to PDF for sponsor delivery.
- **Compliance** — per-project / per-product compliance rulesets
  (standard + finance_au_senior_debt built-in) block unapproved
  language pre-send
- **Operator controls** — daily caps, warmup curves, per-channel
  kill switch, channels page health monitoring
- **Teams** — owner/admin invites teammates via Supabase Auth
  invite-email (branded "InvestorPilot" via Resend SMTP). Each
  member connects their own LinkedIn + email; sequencer picks the
  right member's channel by step ownership. Shared dataroom
  (templates, products, projects, KB, prospects) across the org.
  `/settings/team` for member + role management. Migration 028
  added `client_channels.user_id` + `sequence_steps.created_by_user_id`,
  backfilled to existing owners so single-user orgs see zero
  behaviour change.
- **Public pages reflect what shipped** — landing, playbook, about,
  pricing all updated 2026-05-18 with Teams, Pool Summary as
  sponsor deliverable, Resend bounce auto-handling, and the 14
  auto-translation languages. Landing + playbook ported from inline
  headers to the shared `<PublicHeader />` / `<PublicFooter />`
  components so easy-claude-code's mobile work applies uniformly.
- **HeyGen dashboard explainer video regenerated** — 60s narration
  covering Projects/Products dual mode, tier modulation +
  auto-translation, Pool Summary deliverable, Teams, human-approved
  send + audit trail. New `HEYGEN_VIDEO_ID`
  (`3dfc15c762484fd7997622d0e9e2fe92`) live on Vercel across all
  three envs. Component's dismiss-key now scoped per video_id so
  regenerated narration shows even to operators who dismissed the
  prior version.
- **Middleware fix — webhooks now actually reachable** —
  `src/lib/supabase/middleware.ts` was 401'ing every `/api/*` request
  without a Supabase auth cookie, silently killing both `/api/webhooks/resend`
  and `/api/webhooks/unipile/account` before their own
  signature/secret check could run. Fixed by excluding
  `/api/webhooks/*` from the middleware auth gate; each route still
  self-validates (svix for Resend, shared-secret header for Unipile).
  No security regression. Pre-existing Unipile silent-failure bug
  also resolved by the same one-line fix.
- **HeyGen dashboard video fix** — the regenerated video showed
  HeyGen 404 because `vercel env add` over an `echo` pipe stored the
  HEYGEN_VIDEO_ID with a trailing `\n` (33 bytes not 32). Re-added
  via `printf`, redeployed, video plays. Generator script
  (`scripts/generate-heygen-video.mjs`) now prints the correct
  `printf` invocation at the end of every run so this doesn't recur.

### Architecture

- Next.js 14 on Vercel (corporate-ai-solutions team)
- Supabase (auth + Postgres) — project ref `azelomanmlywwzbpkksy` (Seoul)
- Sequencer renderer in `src/lib/sequencer/render.ts` — shared across
  project + product flows
- Pool Summary aggregation in `src/lib/pool/summary.ts` — shared across
  both kinds; single source of truth for REGION_PATTERNS /
  LANGUAGE_BY_REGION / SECTOR_PATTERNS
- `@caistech/ai-client`, `@caistech/brave-search`,
  `@caistech/hunter-email`, `@caistech/unipile-channels`

### Risk tier: REVENUE

High read:edit discipline. Shared module changes require review of all
consumers. Deployment errors must be resolved before moving to new
features. No "simplest fix" shortcuts — pipeline correctness affects
live email delivery.

## Verify first thing next session

1. **Auto-localisation end-to-end** — geography_hint fix shipped 2026-05-18
   but not yet verified on a live Vietnamese prospect. Render one
   Vietnam-category prospect (Tra Hoang, Duc Luu, Ngoc Nam Nguyen),
   check Vercel logs for `[render] localisation check for X:
   geography_hint=… → target_language=Vietnamese` and `translation to
   Vietnamese succeeded`. Confirm VIETNAMESE badge in approvals queue
   header and that clicking "English version" toggle works.
2. **Teams smoke test** — code + routes + Supabase email templates all
   verified, but no real human invite has been accepted yet. At
   `/settings/team`, invite a test email (alt address), confirm the
   email arrives branded "InvestorPilot", set password, land joined
   to the org as member, connect a LinkedIn via /channels, run
   render-now and confirm the sequencer uses the new member's
   account (not the owner's).
3. **Resend webhook configuration** — operator action: in Resend
   dashboard, add endpoint `https://investor-pilot-pi.vercel.app/api/webhooks/resend`,
   enable events (`email.bounced`, `email.complained`,
   `email.delivery_delayed`, `email.delivered`), copy signing secret
   into Vercel env `RESEND_WEBHOOK_SECRET` for all envs.

## Priority for next session

1. **Bounce → re-enrich auto-flow** — quarter-day
2. **Operator-configurable compliance ruleset** — half-day
3. **Global pause flag** (org-level) — 2-3 hours
4. **Teams follow-ups** (if usage surfaces friction):
   - /approvals UI surface for steps stuck on disconnected channels
   - Channels filter "show only mine" (today shows all org channels)
   - Step reassignment without waiting for channel reconnect

## Key files

### Pipeline + sequencer
- `src/lib/sequencer/render.ts` — renderer (tier, courtesy, value-offer,
  localisation, signature handling); shared across project + product
- `src/lib/sequencer/runner.ts` — step execution; geography_hint built here
- `src/lib/sequencer/generate-from-product.ts` — sequence template
  generation (SYSTEM_PROMPT for product, SYSTEM_PROMPT_PROJECT for
  project; parity-synced 2026-05-18)
- `src/app/api/pipeline/{discover,enrich,draft,send,track}/` —
  deterministic pipeline routes

### Pool summary
- `src/lib/pool/summary.ts` — shared aggregation lib
- `src/components/pool/{pool-summary-view,pool-stat-chip}.tsx` — views
- `src/app/(dashboard)/{projects,products}/[id]/pool/page.tsx`
- `src/app/api/{projects,products}/[id]/pool-report/route.ts`

### Webhooks
- `src/app/api/webhooks/resend/route.ts` — Resend events (svix)
- `src/app/api/webhooks/unipile/account/route.ts` — Unipile channel events

### UI surfaces
- `src/app/(dashboard)/dashboard/page.tsx` — featured Pool Summary cards
- `src/app/(dashboard)/approvals/approvals-client.tsx` — tier + language badges
- `src/app/(dashboard)/partners/[id]/page.tsx` — pool context cross-link
- `src/app/(dashboard)/projects/page.tsx`, `products/page.tsx` —
  PoolStatChip on rows
- `src/app/(dashboard)/settings/team/page.tsx` — team members + invites

### Teams
- `src/app/api/team/invite/route.ts` — Supabase Auth invite-by-email
- `src/app/api/team/members/route.ts` — list org members with channel counts
- `src/app/api/team/members/[id]/route.ts` — PATCH role, DELETE member
- `src/app/auth/callback/route.ts` — joins invited members to their org
- `src/lib/channels/unipile.ts` — auth-link encodes `org_id:user_id`
- `src/app/api/webhooks/unipile/account/route.ts` — parses + lands channel
  with right user_id

### Env

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY, ANTHROPIC_API_KEY, AGENT_MODEL
BRAVE_API_KEY, HUNTER_API_KEY
RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_WEBHOOK_SECRET
UNIPILE_API_KEY, UNIPILE_BASE_URL, UNIPILE_WEBHOOK_SECRET
NEXT_PUBLIC_APP_URL
```
