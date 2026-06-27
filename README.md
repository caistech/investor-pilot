# InvestorPilot

> Finds the right capital providers for a raise (**Projects**) and the right buyers/channel partners for a product (**Products**), then drafts evidence-grounded LinkedIn + email outreach a human approves before it ships — for founders, fundraisers, and the VC/advisory firms running outreach across a portfolio.
> Part of the Corporate AI Solutions portfolio · consumes Operator Core: `@caistech/ai-client`, `@caistech/brave-search`, `@caistech/hunter-email`, `@caistech/apollo-people`, `@caistech/email-finder`, `@caistech/unipile-channels`, `@caistech/sayfix-embed`

**Status:** Live   ·   **License:** MIT   ·   **Live deployment:** https://investor-pilot-pi.vercel.app

## What this is (and isn't)

- **Real and runnable today:**
  - **Discovery + scoring** — Brave web search + LinkedIn 1st/2nd-degree discovery (via Unipile), scored on 5 ICP dimensions with the evidence linked back to each score.
  - **Enrichment** — contact/email discovery (Hunter.io, Apollo people search, the multi-provider email-finder cascade) and LinkedIn profile pull.
  - **Sequencer** — multi-step LinkedIn + email cadence with score-tiered tone (confident / qualified / exploratory), value-offer copy, and signature handling. Renderer shared across Projects and Products.
  - **Auto-localisation** — non-English prospects get their first message rendered in their language (14 languages wired), with the English original preserved for the operator to verify before send.
  - **Approvals queue** — human-in-the-loop sign-off on every draft (fit score, tier, compliance, personalisation), with edit / regenerate / skip / approve.
  - **Send + track** — email via Resend, LinkedIn via Unipile; inbound webhooks for Resend (svix-verified bounce/complaint/delivery) and Unipile channel events.
  - **Multi-tenant teams** — `org/[slug]` workspaces, email invites, owner/admin/member roles, per-member LinkedIn + email channels routed by sequence-step ownership.
  - **Pre-send compliance filter** — per-project/per-product rulesets (a `standard` set + a built-in `finance_au_senior_debt` set) block unapproved language before send.
  - **Pool Summary** — an auto-generated one-page deliverable per project/product.
  - **Agentic assistant** — a Claude tool-calling agent (`/api/agent/run`) with session memory and tools for product/project autofill and pipeline actions.
  - **Deck / KB ingestion** — pitch decks, one-pagers, transcripts via `pdf-parse` / `unpdf` / `mammoth` / `xlsx`, with Claude vision fallback for image-only PDFs.
  - **Scheduled jobs** — Vercel crons for the sequencer, send-queue drain, and discovery jobs.

- **Stubbed / in progress / env-gated (degrade cleanly when unconfigured):**
  - **ElevenLabs voice help widget** — renders only when `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` is set (provisioned via an admin route); absent in dev/preview by design.
  - **HeyGen explainer video** on the dashboard — shows only when `HEYGEN_VIDEO_ID` is configured.
  - **Methodology validation campaigns** — the intake/registration API (`/api/methodology/campaigns`) and the Connexions/pipeline intake webhooks are wired so the portfolio's validation pipeline can register a campaign here; the full per-campaign outreach-state surface is still being built out.
  - **`@caistech/corporate-components`** is declared as a dependency but not yet imported in `src/` (auth/public UI is currently local components).

- **Not in this repo (by design):**
  - The **`@caistech/*` Operator Core packages** themselves — they live in the private `cais-shared-services` hub and are pulled from a private GitHub Packages registry. This repo consumes their compiled `dist/`, never their source (the shared substrate is the moat).
  - **Live secrets and the production database** — only `supabase/` migrations and `*.example` env files are committed; no keys, no data.

## Run it yourself

1. `git clone https://github.com/caistech/investor-pilot.git && cd investor-pilot`
2. **Auth for the private registry.** `.npmrc` pulls `@caistech/*` from GitHub Packages, so before installing, export a GitHub token with `read:packages` scope (authorized for the `caistech` org):
   ```bash
   export NODE_AUTH_TOKEN=<your_github_packages_token>
   ```
   Without this, `npm install` will 401 on the `@caistech/*` dependencies.
3. `cp .env.local.example .env.local` and set the minimum keys (see below). Optionally `cp .env.example .env` for the white-label vendor identity values.
4. `npm install` then `npm run dev` → the app on `http://localhost:3000`: the public landing page, and (once Supabase is set) signup/login into the dashboard, discovery, approvals, and settings.

**Minimum environment** (full list in `.env.local.example` + referenced in code):

| Variable | What it's for | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auth + Postgres (required to boot the app) | Supabase project → Settings → API |
| `ANTHROPIC_API_KEY` | Claude (drafting, scoring, vision, the agent) | console.anthropic.com |
| `OPENROUTER_API_KEY`, `AGENT_MODEL` | Optional LLM routing / model override | openrouter.ai |
| `BRAVE_API_KEY` | Web-search discovery | brave.com/search/api |
| `HUNTER_API_KEY` | Email finder + company logos | hunter.io |
| `APOLLO_API_KEY` | People search / enrichment (optional) | apollo.io |
| `UNIPILE_API_KEY`, `UNIPILE_BASE_URL`, `UNIPILE_WEBHOOK_SECRET` | LinkedIn discovery + send + channel webhooks | unipile.com |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` | Email send + bounce webhooks (use a Resend-verified sender) | resend.com |
| `CRON_SECRET` | Protects the scheduled cron routes | any random string you set on Vercel |
| `NEXT_PUBLIC_APP_URL` | Absolute links in emails/invites | your deployment URL |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`, `HEYGEN_VIDEO_ID` | Optional voice widget / explainer video (off when unset) | ElevenLabs / HeyGen |

> Never commit real values — `.env.local` is gitignored. The examples above are placeholders only.

## Architecture (what it calls)

- **Next.js 14 (App Router)** on Vercel — public marketing pages, an authenticated `org/[slug]/*` dashboard, and `/api/*` route handlers (pipeline, approvals, sequences, team, webhooks, cron).
- **Supabase** — auth (`@supabase/ssr`) and Postgres (schema in `supabase/` migrations); middleware gates dashboard + API routes and resolves the active org.
- **Operator Core (`@caistech/*`)** — `ai-client` (Claude), `brave-search`, `hunter-email`, `apollo-people`, `email-finder` for discovery/enrichment; `unipile-channels` for LinkedIn; `sayfix-embed` for in-app bug reporting.
- **External APIs** — Anthropic (drafting/scoring/vision/agent), Resend (email + svix-verified webhooks), Unipile (LinkedIn), Brave, Hunter, Apollo, optional Firecrawl (page scraping), ElevenLabs + HeyGen (optional media).

## Verify it's real

- Live deployment: https://investor-pilot-pi.vercel.app
- Source you're reading: this repo.

## License

MIT — Copyright (c) 2026 Dennis McMahon. See [LICENSE](./LICENSE).
