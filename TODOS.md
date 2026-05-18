# TODOS

Captured during /plan-eng-review on 2026-05-18 (multi-org refactor planning).

## Per-org pricing tier + /settings/billing UI

**What:** Per-org subscription tier (solo / team / agency-operator) with Stripe subscription scoped to organisations table, exposed via /settings/billing.

**Why:** Once multi-org ships with BYOK Unipile, agency-tier users get the full feature surface for free. A pricing tier lets the product capture revenue commensurate with the access; the WTP form already collects interest in solo/team/agency-operator structures.

**Pros:**
- Aligns product reality with the pricing structure the WTP form is already collecting interest for.
- Prevents the "multi-org is free forever" default that becomes politically hard to walk back.
- Stripe subscriptions per-org are the standard SaaS shape; clean abstraction.

**Cons:**
- Adds Stripe + webhook surface to an already complex auth/org system.
- Requires a downgrade path (what happens if an agency cancels — keep their channels read-only? Lock them out?).
- Pricing decisions (what does each tier cost, what's gated, what's metered) require Dennis's product call before any code.

**Context:** The multi-org refactor unlocks BYOK Unipile (agency tier) and pending invitations (team tier), but enforces no tier. Friendly dogfooders are fine on the free path; first paying agency user is the trigger to ship this.

**Depends on / blocked by:** Multi-org refactor (this is a follow-up after that lands).

---

## Playwright E2E test suite

**What:** Add Playwright as a dependency and ship E2E specs for the dashboard navigation, org switcher click, invite-accept flow, and /settings/integrations roundtrip.

**Why:** Tier 3 of the multi-org test coverage was deferred because vitest covers unit/integration well and Playwright is a new dependency + CI setup. Worth adding when there's a 2nd customer cohort.

**Depends on / blocked by:** Multi-org refactor ships; second customer cohort triggers the need.

---

## BYOK Unipile resolver unit tests

**What:** Vitest unit tests for `resolveUnipileKey(org_id)` covering the three paths: org has key, org has no key but env var exists, both missing.

**Why:** Tier 3 deferred from the multi-org test scope. The /settings/integrations roundtrip test (manual) covers happy path; unit tests would cover all three branches in isolation.

**Depends on / blocked by:** Multi-org refactor ships.

---

## Webhook tenant routing tests

**What:** Vitest test for /api/webhooks/unipile/account dispatch: payload from tenant A routes to org A; unknown tenant logged + 200 (no crash).

**Why:** Tier 3 deferred from multi-org test scope.

**Depends on / blocked by:** Multi-org refactor ships, second BYOK customer to expose the multi-tenant case.

---

## Org transfer / merge

**What:** /settings/team flow for transferring ownership of an org to another member (David transfers Koch to a co-founder). Merging two orgs into one is a separate but related operation.

**Why:** Not in current demand. Add when a customer asks.

---

## Per-org SSO / SAML

**What:** Enterprise tier feature — orgs can configure SAML / OIDC SSO for their team's logins.

**Why:** Not needed for the friendly dogfood cohort. Add when an enterprise prospect raises it.
