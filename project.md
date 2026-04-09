# PartnerPilot — Project Build Instructions
# Location: C:\Users\denni\PycharmProjects\PartnerPilot\project.md
# Instruction: Read this file completely before taking any action.
# Execute every step in sequence. Do not skip steps.
# Do not ask for confirmation between steps unless explicitly instructed.
# gstacks is installed at ~/.claude/skills/gstack and all slash commands
# are available. Run each gstacks command at the stage indicated and
# resolve all issues raised before proceeding to the next step.

---

## STEP 0 — PRE-BUILD CHECKS

Before doing anything else:

1. Check all existing repos at https://github.com/dennissolver/ to confirm
   no existing PartnerPilot or partnerships-related repo exists that could
   be reused or extended. If one exists, stop and report to Dennis.

2. Check C:\Users\denni\PycharmProjects\ for any existing project folders
   that contain partnerships, outreach, or channel partner logic that could
   be reused as a module. Report findings before proceeding.

3. Check the Corporate AI Solutions common modules library for any of the
   following that should be imported rather than rebuilt:
   - Authentication / session management module
   - Supabase client initialisation module
   - Resend email module
   - Row-level security policy templates
   - Corporate AI Solutions UI style guide and component library
   Report which modules are available and confirm they will be referenced.

4. Confirm Node.js is installed and npx is available on this machine.
   Brave Search MCP runs via npx and requires Node.js to be present.

---

## STEP 1 — GSTACKS: IDEATION AND PRODUCT REVIEW

Run these three gstacks commands in sequence against this project.md
and the CLAUDE.md file. Resolve all issues raised before proceeding.

### 1a — Office Hours
Run: /office-hours

Apply this project.md and CLAUDE.md as the context.
This runs YC-style forcing questions on the product concept.
Surface all concerns, weak assumptions, and gaps identified.
Do not proceed to 1b until all issues are addressed.

### 1b — CEO Review
Run: /plan-ceo-review

Review the full product plan for scope, 10-star thinking,
and product-level decisions. Surface any concerns about
the product definition, feature set, or go-to-market approach.
Do not proceed to 1c until all issues are addressed.

### 1c — Engineering Review
Run: /plan-eng-review

Review the full architecture plan for:
- Data flow correctness (MCP → pipeline → Supabase → UI)
- Edge cases in the agent pipeline
- Performance implications of streaming agent sessions
- Security considerations for MCP key handling
- Schema design review
- Any architectural risks in the MCP-first approach
Do not proceed to Step 2 until all issues are addressed
and the architecture is confirmed sound.

### 1d — Design Review
Run: /plan-design-review

Review the planned UI and UX for:
- Agent chat interface usability
- Partner pipeline dashboard clarity
- Approval gate interaction design
- Mobile responsiveness requirements
Record all design decisions made here for reference during build.
Do not proceed to Step 2 until design direction is confirmed.

---

## STEP 2 — GITHUB REPOSITORY

Create a new GitHub repository with the following configuration:

- Account: https://github.com/dennissolver/
- Repository name: partner-pilot
- Visibility: Private
- Description: PartnerPilot — AI-powered partnerships pipeline agent
  built by Corporate AI Solutions
- Initialise with: README.md
- .gitignore: Next.js template
- Default branch: main

After creation, clone the repository to:
C:\Users\denni\PycharmProjects\PartnerPilot\

Confirm the clone is successful before proceeding.

---

## STEP 3 — NEXT.JS PROJECT INITIALISATION

Inside C:\Users\denni\PycharmProjects\PartnerPilot\ initialise a
Next.js project with the following configuration:

- Framework: Next.js 14 (App Router)
- Language: TypeScript
- Styling: Tailwind CSS
- ESLint: Yes
- src/ directory: Yes
- Import alias: @/*

Install the following dependencies:
- @supabase/supabase-js
- @supabase/ssr
- resend
- @anthropic-ai/sdk
- lucide-react
- date-fns
- xlsx (for Excel export functionality)

Install the following dev dependencies:
- @types/node
- @types/react
- @types/react-dom

Create next.config.js with the following configuration to whitelist
the Hunter Logos API domain for Next.js Image component:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'logos.hunter.io',
        port: '',
        pathname: '/**',
      },
    ],
  },
}

module.exports = nextConfig
```

Note: remotePatterns is the preferred approach over the deprecated
domains array in Next.js 14. This must be in place before any
partner-card.tsx or partner-table.tsx components are built,
otherwise Next.js will throw an error when rendering company logos.

Apply the Corporate AI Solutions Tailwind config and global CSS
style guide from the common modules library.

Push the initialised project to the GitHub repo (main branch).

---

## STEP 4 — VERCEL PROJECT

Create a new Vercel project with the following configuration:

- Project name: partner-pilot
- Framework preset: Next.js
- Connect to GitHub repo: dennissolver/partner-pilot
- Root directory: ./
- Build command: next build
- Output directory: .next
- Install command: npm install
- Production branch: main

After creation:
- Note the production URL (format: partner-pilot.vercel.app or similar)
- Note the deployment URL for use in Supabase configuration below

Do not add environment variables to Vercel yet — this happens in
Step 7 after Supabase is configured.

---

## STEP 5 — SUPABASE PROJECT

Create a new Supabase project with the following configuration:

- Project name: partner-pilot
- Organisation: use Dennis's existing Corporate AI Solutions organisation
- Region: ap-southeast-2 (Sydney — Australian data residency)
- Database password: generate a strong password and record in .env.local

After the project is created and fully initialised:

### 5a — Authentication Configuration

In Supabase Auth settings configure:

Site URL: https://partner-pilot.vercel.app
(update once exact Vercel URL is confirmed)

Redirect URLs (add all of the following):
- https://partner-pilot.vercel.app/auth/callback
- https://partner-pilot.vercel.app/**
- http://localhost:3000/auth/callback
- http://localhost:3000/**

Enable the following auth providers:
- Email (enabled by default — magic link + password)

Email templates: update confirmation and magic link emails
to use Corporate AI Solutions branding.

### 5b — Database Schema

Execute the following SQL in the Supabase SQL editor:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organisations table (multi-tenant support)
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  full_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  one_sentence_description TEXT,
  core_mechanism TEXT,
  customer_outcomes TEXT,
  icp_company_size TEXT,
  icp_stage TEXT,
  icp_verticals TEXT,
  icp_buyer_title TEXT,
  icp_user_title TEXT,
  icp_stack_tools TEXT,
  traction_arr TEXT,
  traction_customers TEXT,
  traction_logos TEXT,
  partner_types TEXT DEFAULT 'referral',
  exclusions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partners table (the CRM)
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  domain TEXT,
  logo_url TEXT,
  partner_type TEXT CHECK (partner_type IN (
    'referral', 'integration', 'reseller', 'combination'
  )),
  category TEXT,
  status TEXT DEFAULT 'scored' CHECK (status IN (
    'scored', 'contact_found', 'contact_partial', 'angle_defined',
    'draft_ready', 'sent', 'replied', 'follow_up_due',
    'meeting_booked', 'qualified', 'active_partner_discussion',
    'disqualified', 'closed_won', 'closed_lost'
  )),
  weighted_score NUMERIC(4,2),
  confidence_score TEXT CHECK (confidence_score IN (
    'normal', 'low-confidence'
  )),
  audience_overlap_notes TEXT,
  complementarity_notes TEXT,
  partner_readiness_notes TEXT,
  reachability_notes TEXT,
  contact_name TEXT,
  contact_title TEXT,
  contact_email TEXT,
  contact_linkedin TEXT,
  email_confidence INTEGER,
  email_status TEXT CHECK (email_status IN (
    'verified', 'probable', 'company_level', 'unresolved'
  )),
  contact_source TEXT,
  selected_gtm_angle TEXT,
  partnership_motion TEXT,
  draft_status TEXT CHECK (draft_status IN (
    'none', 'created', 'approved', 'filed'
  )),
  draft_subject TEXT,
  draft_body TEXT,
  gmail_draft_id TEXT,
  hunter_lead_id INTEGER,
  hunter_sequence_id INTEGER,
  hunter_sending_status TEXT,
  screened_out BOOLEAN DEFAULT FALSE,
  screened_out_reason TEXT,
  last_session_notes TEXT,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent sessions table
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  mode TEXT CHECK (mode IN ('guided', 'batch')),
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active', 'completed', 'paused'
  )),
  partners_added INTEGER DEFAULT 0,
  partners_updated INTEGER DEFAULT 0,
  contacts_found INTEGER DEFAULT 0,
  drafts_filed INTEGER DEFAULT 0,
  hunter_leads_pushed INTEGER DEFAULT 0,
  session_log JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id)
);

-- Session events table
CREATE TABLE session_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API keys table
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN (
    'hunter', 'brave', 'anthropic', 'resend', 'gmail'
  )),
  key_value TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own organisation"
  ON organisations FOR SELECT
  USING (owner_id = auth.uid() OR id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can manage their own profile"
  ON profiles FOR ALL USING (id = auth.uid());

CREATE POLICY "Org members can view products"
  ON products FOR SELECT
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can manage products"
  ON products FOR ALL
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can view partners"
  ON partners FOR SELECT
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can manage partners"
  ON partners FOR ALL
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can view sessions"
  ON agent_sessions FOR SELECT
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can manage sessions"
  ON agent_sessions FOR ALL
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can view session events"
  ON session_events FOR SELECT
  USING (session_id IN (
    SELECT id FROM agent_sessions WHERE organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  ));

CREATE POLICY "Org members can manage api keys"
  ON api_keys FOR ALL
  USING (organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid()
  ));

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organisations_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

Confirm all tables, RLS policies, and triggers created successfully.

### 5c — Supabase API Keys

From Supabase project settings, note:
- Project URL
- Anon (public) key
- Service role key (server-side only — never expose to client)

---

## STEP 6 — MCP CONFIGURATION

This is the core integration layer. PartnerPilot uses three MCP
servers for all external data operations.

CRITICAL RULE: No REST client code for Hunter or Brave Search.
Use MCP exclusively. The only direct HTTP call to Hunter is the
Logos API — no auth required, UI enrichment only.

### 6a — Create .mcp.json

Create C:\Users\denni\PycharmProjects\PartnerPilot\.mcp.json:

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    },
    "hunter": {
      "type": "http",
      "url": "https://mcp.hunter.io/mcp",
      "headers": {
        "Authorization": "Bearer ${HUNTER_API_KEY}"
      }
    },
    "gmail": {
      "type": "http",
      "url": "https://gmail.mcp.claude.com/mcp"
    }
  }
}
```

Add .mcp.json to .gitignore — never commit it.

### 6b — MCP Capabilities Reference

BRAVE SEARCH MCP (local via npx):
- brave_web_search — candidate discovery, company research, browsing
- brave_local_search — location-based searches if needed
- brave_news_search — recent news about partner candidates

HUNTER MCP (remote at https://mcp.hunter.io/mcp):
- domain_search — all emails at a domain
- email_finder — find email by name + domain
- email_verifier — verify email deliverability
- create_lead — push verified contact to Hunter
- create_or_update_lead — upsert lead by email
- list_sequences — get available Hunter sequences
- add_recipient_to_sequence — enroll lead in sequence (optional)

HUNTER LOGOS API (no auth, no MCP — direct fetch for UI only):
- URL pattern: https://logos.hunter.io/{domain}
- Returns company logo image directly
- Call during discovery phase for every candidate
- Store result URL in partners.logo_url
- On 404 fall back to generated initial avatar
- Helper: getCompanyLogoUrl(domain) in src/lib/utils.ts

GMAIL MCP (remote):
- Create pre-addressed draft emails
- File to Dennis's Gmail drafts folder on approval

### 6c — Hunter Lead Push Logic

After contact reaches verified/probable status, optionally push:
1. Call hunter create_or_update_lead MCP with full contact details
2. Store returned lead ID in partners.hunter_lead_id
3. Optional: present sequence list, enroll via
   add_recipient_to_sequence MCP
4. Store hunter_sequence_id and track hunter_sending_status
This is always a founder choice — never automatic.

---

## STEP 7 — ENVIRONMENT VARIABLES

### 7a — Create .env.local

Create C:\Users\denni\PycharmProjects\PartnerPilot\.env.local:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key

# Resend
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_EMAIL=noreply@corporateaisolutions.com

# Hunter (MCP + Logos API)
HUNTER_API_KEY=your_hunter_api_key

# Brave Search (MCP via npx)
BRAVE_API_KEY=your_brave_api_key

# App
NEXT_PUBLIC_APP_URL=https://partner-pilot.vercel.app
NEXT_PUBLIC_APP_NAME=PartnerPilot
```

.env.local and .mcp.json must both be in .gitignore.

### 7b — Add to Vercel

Add all variables to Vercel → Settings → Environment Variables.
Apply to: Production, Preview, and Development.

---

## STEP 8 — RESEND CONFIGURATION

1. Verify domain: corporateaisolutions.com
2. Create API key: "partner-pilot-production"
3. From address: PartnerPilot <noreply@corporateaisolutions.com>

---

## STEP 9 — APPLICATION STRUCTURE

Build the following file and folder structure:

```
src/
  app/
    (auth)/
      login/page.tsx
      signup/page.tsx
      auth/callback/route.ts
    (dashboard)/
      layout.tsx
      dashboard/page.tsx
      partners/
        page.tsx
        [id]/page.tsx
      products/
        page.tsx
        new/page.tsx
      sessions/
        page.tsx
        [id]/page.tsx
      settings/page.tsx
    api/
      agent/
        run/route.ts
        score/route.ts
        browse/route.ts
        find-contact/route.ts
        draft/route.ts
        hunter-push/route.ts
      partners/
        route.ts
        [id]/route.ts
      export/route.ts
    layout.tsx
    page.tsx
  components/
    ui/
      button.tsx, card.tsx, badge.tsx, input.tsx
      textarea.tsx, select.tsx, modal.tsx, table.tsx, toast.tsx
    layout/
      sidebar.tsx, header.tsx, nav.tsx
    partners/
      partner-card.tsx        ← company logo via Hunter Logos API
      partner-table.tsx       ← logo column included
      partner-detail.tsx
      status-badge.tsx
      score-display.tsx
      hunter-push-button.tsx  ← push to Hunter leads/sequences
    sessions/
      session-log.tsx
      session-summary.tsx
    agent/
      agent-chat.tsx
      mode-selector.tsx
      approval-gate.tsx
  lib/
    supabase/
      client.ts, server.ts, middleware.ts
    agent/
      pipeline.ts         ← orchestrates all MCP calls
      scoring.ts
      browsing.ts         ← brave_web_search MCP
      contact-finder.ts   ← hunter email_finder MCP
      motion-selector.ts
      email-drafter.ts    ← Anthropic API
      hunter-push.ts      ← hunter create_lead MCP
    utils.ts              ← getCompanyLogoUrl(domain)
    types.ts
  middleware.ts
```

---

## STEP 10 — GSTACKS: DESIGN CONSULTATION

Before writing any component code, run:

Run: /design-consultation

Context: the full application structure from Step 9 and all
design decisions recorded during /plan-design-review in Step 1d.

This resolves mid-build design system decisions including:
- Component patterns for the agent chat interface
- Status badge system and colour mapping
- Partner card layout with company logo integration
- Approval gate interaction patterns
- Dashboard layout and data density

Record all decisions made. Apply them consistently throughout
all component builds in Steps 11–14.

---

## STEP 11 — AGENT PIPELINE

Build at src/lib/agent/pipeline.ts

All external data calls go through MCP only.
Never make direct REST calls to Hunter or Brave Search.

STAGE 1 — INITIALISE
- Load product profile from Supabase
- Load existing partner records from Supabase
- Ask founder: guided mode or batch mode?

STAGE 2 — GENERATE CATEGORIES
- Call Anthropic API with product profile
- Return 5-8 categories with audience overlap rationale
- Guided mode: surface for founder approval

STAGE 3 — SEARCH FOR CANDIDATES
- For each category, call brave_web_search MCP
- Use query patterns from CLAUDE.md discovery protocol
- Extract company names and domains
- For each domain: store logo_url as https://logos.hunter.io/{domain}
- Deduplicate across categories

STAGE 4 — NEGATIVE SCREENING
- Run screening logic per CLAUDE.md rules
- Use brave_web_search to verify if needed
- Mark screened_out = true with reason

STAGE 5 — SCORE CANDIDATES
- Use brave_web_search MCP to gather evidence per dimension
- Call Anthropic API with evidence + scoring rubric from CLAUDE.md
- Score 5 dimensions: audience overlap (30%), complementarity (25%),
  partner readiness (20%), reachability (15%), strategic leverage (10%)
- Flag low-confidence candidates
- Guided mode: surface top 10 for approval

STAGE 6 — BROWSE AND FIND CONTACTS
- Use brave_web_search MCP to visit pages in order:
  Homepage → /about → /team → /company → /leadership →
  /partners → /integrations → /ecosystem → /platform → /contact
- Extract contact names and titles
- Follow CLAUDE.md browsing protocol exactly
- Guided mode: surface contact records for approval

STAGE 7 — HUNTER EMAIL ENRICHMENT
- Call hunter email_finder MCP: domain, first_name, last_name
- Fallback: call hunter domain_search MCP, match by title
- Call hunter email_verifier MCP on found email
- Assign status: verified / probable / company_level / unresolved
- Update partner record in Supabase

STAGE 8 — MOTION SELECTION
- Call Anthropic API with partner data + motion rules from CLAUDE.md
- Guided mode: surface proposed motion for approval

STAGE 9 — DRAFT OUTREACH
- Collect evidence list
- Run hygiene checks against existing pipeline data
- Call Anthropic API to build GTM angle and draft email
- Apply anti-hallucination rules from CLAUDE.md
- Surface draft for founder approval before filing

STAGE 10 — GMAIL FILING
- On approval, call Gmail MCP to create draft
- Update: draft_status = "created", status = "draft_ready"
- Save to Supabase

STAGE 11 — OPTIONAL HUNTER LEAD PUSH
- Ask founder: "Push to Hunter? (yes / no / add to sequence)"
- If yes: call hunter create_or_update_lead MCP
- If sequence: call list_sequences, present options,
  call add_recipient_to_sequence MCP
- Store hunter_lead_id, hunter_sequence_id in Supabase

STAGE 12 — END OF SESSION
- Write all updates to Supabase
- Generate session summary
- Print manual review queue by failure type
- Ask founder to update post-send statuses
- Ask whether to export to Excel

All stages must:
- Write state to Supabase after each stage
- Never fabricate data — mark missing explicitly
- Log every MCP call to session_events table
- Handle MCP errors gracefully
- Never fall back to REST if MCP unavailable — surface error

---

## STEP 12 — CORE PAGES AND COMPONENTS

Build all pages and components applying design decisions from
Step 10 (/design-consultation) throughout.

DASHBOARD (/dashboard)
- Pipeline count cards by status with colour coding
- Recent session activity feed
- Partners needing attention (follow_up_due, contact_partial)
- Hunter leads push queue
- Start New Session button

PARTNERS (/partners)
- Table with company logo (Hunter Logos API), name, score,
  status, partner type, last updated
- Status badge colour coding:
  scored: grey | contact_found: blue | angle_defined: purple |
  draft_ready: amber | sent: orange | replied/meeting_booked: green |
  disqualified/closed_lost: red | closed_won: emerald
- Filter, search, bulk actions
- Hunter sync status indicator per row

PARTNER DETAIL (/partners/[id])
- Company logo, score breakdown with evidence per dimension
- Contact details with confidence indicator
- Draft email with approve / revise / skip actions
- Hunter lead status and sequence enrollment option
- Session history, manual status update, notes field

PRODUCTS (/products)
- Product list and new product form with all ICP fields
- R&D Tax Tracker pre-seeded as first product

SESSIONS (/sessions + /sessions/[id])
- Session list with stats including hunter_leads_pushed
- Full session detail with MCP call log inline

SETTINGS (/settings)
- API key management: Hunter, Brave, Anthropic
- Gmail OAuth connection status
- Hunter sequences management
- Resend config, org profile, user management

AGENT CHAT (src/components/agent/agent-chat.tsx)
- Chat-style thread of agent actions and outputs
- Approval gates as interactive UI:
  Approve (green) | Request revision (amber + text) |
  Skip (grey) | Push to Hunter (blue — after draft filed)
- Pipeline stage progress indicator
- Pause / resume session controls
- Real-time updates via Supabase realtime
- Connects to /api/agent/run via Server-Sent Events

EXPORT (/api/export)
- partners.xlsx matching CLAUDE.md Excel CRM columns
- CSV option, filter by status / product / date range
- Includes hunter_lead_id and hunter_sending_status columns

LANDING PAGE (/)
- Redirect logged-in users to /dashboard
- Corporate AI Solutions style guide
- PartnerPilot value proposition
- Attribution: "Inspired by Guillermo Flor's Partnerships Agent
  Playbook" with link to original article
- CTA: Start Free Trial / Request Access
- CAS footer: corporateaisolutions.com |
  dennis@corporateaisolutions.com | +61 402 612 471

---

## STEP 13 — MIDDLEWARE AND SECURITY

Configure src/middleware.ts:
- Protect all /dashboard routes — redirect to /login if no session
- Protect all /api routes — return 401 if no valid session
- Handle Supabase session refresh on every request

Apply Corporate AI Solutions security module:
- Input sanitisation on all form fields
- Rate limiting on API routes
- CSRF protection

MCP Security:
- Hunter and Brave API keys server-side only — never client-exposed
- All MCP calls in API routes or server components only
- Gmail MCP authenticated via OAuth — not API key

---

## STEP 14 — GSTACKS: DESIGN REVIEW

After all pages and components are built, run:

Run: /design-review

This performs a visual and interaction audit of the full
application with before/after fixes applied automatically.

Areas to review:
- Agent chat interface rendering and interaction
- Partner pipeline dashboard visual hierarchy
- Approval gate usability
- Company logo display and fallback avatar
- Status badge legibility
- Mobile responsiveness across all pages
- Consistency with CAS style guide

Resolve all issues raised before proceeding to Step 15.

---

## STEP 15 — GSTACKS: QA

After design review is complete and all fixes are applied, run:

Run: /qa

This performs full browser-based QA and auto-fixes bugs found.

Key flows to exercise:
- Auth: signup, login, magic link, logout
- Product creation and editing
- Agent session: guided mode full pipeline end to end
- Agent session: batch mode full pipeline end to end
- Partner detail: approve draft, push to Hunter
- Export: xlsx and CSV download
- Settings: API key save and validation
- Gmail MCP: draft creation and confirmation
- Hunter MCP: email finder and lead push
- Brave Search MCP: candidate discovery search

Resolve all bugs found before proceeding to Step 16.

---

## STEP 16 — GSTACKS: CODE REVIEW AND HEALTH CHECK

Run both of the following in sequence:

### 16a — Code Review
Run: /review

Paranoid pre-landing code review covering:
- Security vulnerabilities
- MCP key exposure risks
- Supabase RLS completeness
- TypeScript type safety
- Error handling coverage
- Any hardcoded values that should be environment variables

Resolve all issues before proceeding to 16b.

### 16b — Health Check
Run: /health

Generate code quality dashboard (0-10 score).
Target minimum score: 7/10 before proceeding.
Address any issues pulling the score below 7.

---

## STEP 17 — FINAL DEPLOYMENT VERIFICATION

Before shipping, verify all systems manually:

1. npm run build locally — confirm zero TypeScript errors
2. Confirm Vercel auto-deploys on push to main
3. Confirm production URL accessible
4. Test auth flow end to end in production
5. Test Supabase connection from production environment
6. Test Brave Search MCP: search "R&D tax consultants Australia"
   — confirm results return correctly
7. Test Hunter MCP: email_finder on a known test domain
   — confirm confidence score returns
8. Test Hunter Logos API: fetch https://logos.hunter.io/hunter.io
   — confirm logo image returns
9. Test Gmail MCP: create test draft to test@example.com
   — confirm appears in Dennis's Gmail drafts folder
10. Run complete guided mode agent session with R&D Tax Tracker
    as product — confirm full pipeline executes end to end
    including Gmail filing and optional Hunter lead push

---

## STEP 18 — GSTACKS: SHIP

Run: /ship

This runs tests, final review, generates changelog, and creates
the pull request. Confirm the PR is clean before proceeding.

---

## STEP 19 — GSTACKS: LAND AND DEPLOY

Run: /land-and-deploy

This merges the PR, waits for CI to pass, and verifies
production health after deployment.

Confirm production is healthy before proceeding.

---

## STEP 20 — GSTACKS: CANARY MONITORING

Run: /canary

Post-deploy monitoring for errors and regressions.
Monitor for a minimum of 10 minutes after deployment.
Surface any errors or performance regressions to Dennis
before closing the build session.

---

## REFERENCE FILES

Agent session behaviour governed by:
C:\Users\denni\PycharmProjects\PartnerPilot\CLAUDE.md

The pipeline (Step 11) must implement all protocols in
CLAUDE.md exactly as specified.

---

## NOTES FOR CLAUDE CODE

- Corporate AI Solutions product — apply all CAS conventions,
  style guides, and common modules throughout
- Check all existing CAS repos before building any utility —
  reuse first, build second
- Working title: PartnerPilot (may change after Guillermo collab)
- Hunter and Brave: MCP only. No REST clients for these services.
- Hunter Logos API is the single direct HTTP exception —
  no auth, UI only, no credits consumed
- .mcp.json must be created and verified before pipeline code runs
- All gstacks commands must be run at the stages specified —
  do not skip them or defer them to after the build is complete
- Dennis's GitHub: https://github.com/dennissolver/
- Dennis's contact: dennis@corporateaisolutions.com
- All infrastructure: ap-southeast-2 (Sydney) where possible
