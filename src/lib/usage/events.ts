/**
 * Org-scoped usage metering for cost-driving external services.
 *
 *   logEvent(orgId, type, units?, metadata?)  — fire-and-forget event log
 *   checkCap(orgId, type)                     — pre-flight {allowed, used, limit}
 *   getMonthlyUsage(orgId)                    — for the /settings card
 *
 * Writes go through the service role client because RLS on usage_events
 * blocks all client writes by design (the log is append-only and trusted
 * by the API routes that produce it).
 */

import { createServiceClient } from '@/lib/supabase/server';

export type UsageEventType =
  | 'brave_query'
  | 'hunter_lookup'
  | 'apollo_search'
  | 'apollo_enrichment'
  | 'unipile_account_active'
  | 'llm_tokens';

export interface UsageEventMetadata {
  route?: string;
  model?: string;
  query?: string;
  partner_id?: string;
  [key: string]: unknown;
}

export interface CapCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  plan_tier: string;
  hard_block: boolean;
  reason?: string;
}

export interface MonthlyUsage {
  brave_queries: { used: number; limit: number };
  hunter_lookups: { used: number; limit: number };
  apollo_searches: { used: number; limit: number };
  apollo_enrichments: { used: number; limit: number };
  unipile_accounts: { used: number; limit: number };
  llm_tokens: { used: number; limit: number };
  plan_tier: string;
  billing_month: string;
}

const CAP_COLUMN_BY_EVENT: Record<UsageEventType, keyof UsageCapsRow> = {
  brave_query: 'cap_brave_queries_per_month',
  hunter_lookup: 'cap_hunter_lookups_per_month',
  apollo_search: 'cap_apollo_searches_per_month',
  apollo_enrichment: 'cap_apollo_enrichments_per_month',
  unipile_account_active: 'cap_unipile_accounts',
  llm_tokens: 'cap_llm_tokens_per_month',
};

interface UsageCapsRow {
  organisation_id: string;
  plan_tier: string;
  cap_brave_queries_per_month: number;
  cap_hunter_lookups_per_month: number;
  cap_apollo_searches_per_month: number;
  cap_apollo_enrichments_per_month: number;
  cap_unipile_accounts: number;
  cap_llm_tokens_per_month: number;
  hard_block: boolean;
}

/**
 * Log a usage event. Never throws — metering failures must not break the
 * user-visible request. If the DB is down we lose a count and move on.
 */
export async function logEvent(
  organisation_id: string,
  event_type: UsageEventType,
  units = 1,
  metadata?: UsageEventMetadata,
): Promise<void> {
  if (!organisation_id) return;
  try {
    const db = createServiceClient();
    await db.from('usage_events').insert({
      organisation_id,
      event_type,
      units,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.warn('[usage] logEvent failed', { event_type, err: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Check whether the org is under its cap for the given event type.
 * Brave/Hunter/LLM are monthly; Unipile is a current-active-count check
 * (we sum `units` of unipile_account_active events as the running total,
 * which the webhook decrements with a negative `units` on disconnect).
 */
export async function checkCap(
  organisation_id: string,
  event_type: UsageEventType,
): Promise<CapCheckResult> {
  const db = createServiceClient();

  const { data: caps } = await db
    .from('organisation_usage_caps')
    .select('*')
    .eq('organisation_id', organisation_id)
    .maybeSingle();

  // Fallback to trial defaults if the row is missing — shouldn't happen
  // because of the trigger in migration 021, but defensive.
  const capsRow: UsageCapsRow = (caps as UsageCapsRow | null) ?? {
    organisation_id,
    plan_tier: 'trial',
    cap_brave_queries_per_month: 200,
    cap_hunter_lookups_per_month: 200,
    cap_apollo_searches_per_month: 1000,
    cap_apollo_enrichments_per_month: 185,
    cap_unipile_accounts: 2,
    cap_llm_tokens_per_month: 2_000_000,
    hard_block: true,
  };

  const limit = capsRow[CAP_COLUMN_BY_EVENT[event_type]] as number;
  const used = await sumUsage(organisation_id, event_type);
  const remaining = Math.max(0, limit - used);
  const allowed = used < limit || !capsRow.hard_block;

  return {
    allowed,
    used,
    limit,
    remaining,
    plan_tier: capsRow.plan_tier,
    hard_block: capsRow.hard_block,
    reason: allowed
      ? undefined
      : `Monthly ${event_type.replace(/_/g, ' ')} cap reached (${used}/${limit} on the ${capsRow.plan_tier} plan). Upgrade in /settings or contact support.`,
  };
}

/** Sum used units for the current billing month, or all-time for unipile. */
async function sumUsage(organisation_id: string, event_type: UsageEventType): Promise<number> {
  const db = createServiceClient();

  // Unipile accounts is a running count (insert on connect, negative units
  // on disconnect via the webhook). All others are monthly aggregates.
  const isMonthly = event_type !== 'unipile_account_active';
  const billingMonth = new Date();
  billingMonth.setDate(1);
  billingMonth.setHours(0, 0, 0, 0);

  let query = db
    .from('usage_events')
    .select('units')
    .eq('organisation_id', organisation_id)
    .eq('event_type', event_type);

  if (isMonthly) {
    query = query.gte('created_at', billingMonth.toISOString());
  }

  const { data } = await query;
  if (!data) return 0;
  return data.reduce((sum, row) => sum + (row.units as number), 0);
}

/**
 * Snapshot of every cap and current usage for an org — used by the
 * /settings "Usage this month" card.
 */
export async function getMonthlyUsage(organisation_id: string): Promise<MonthlyUsage> {
  const db = createServiceClient();

  const { data: caps } = await db
    .from('organisation_usage_caps')
    .select('*')
    .eq('organisation_id', organisation_id)
    .maybeSingle();

  const capsRow: UsageCapsRow = (caps as UsageCapsRow | null) ?? {
    organisation_id,
    plan_tier: 'trial',
    cap_brave_queries_per_month: 200,
    cap_hunter_lookups_per_month: 200,
    cap_apollo_searches_per_month: 1000,
    cap_apollo_enrichments_per_month: 185,
    cap_unipile_accounts: 2,
    cap_llm_tokens_per_month: 2_000_000,
    hard_block: true,
  };

  const [brave, hunter, apolloSearch, apolloEnrich, unipile, llm] = await Promise.all([
    sumUsage(organisation_id, 'brave_query'),
    sumUsage(organisation_id, 'hunter_lookup'),
    sumUsage(organisation_id, 'apollo_search'),
    sumUsage(organisation_id, 'apollo_enrichment'),
    sumUsage(organisation_id, 'unipile_account_active'),
    sumUsage(organisation_id, 'llm_tokens'),
  ]);

  const billingMonth = new Date();
  billingMonth.setDate(1);

  return {
    brave_queries: { used: brave, limit: capsRow.cap_brave_queries_per_month },
    hunter_lookups: { used: hunter, limit: capsRow.cap_hunter_lookups_per_month },
    apollo_searches: { used: apolloSearch, limit: capsRow.cap_apollo_searches_per_month },
    apollo_enrichments: { used: apolloEnrich, limit: capsRow.cap_apollo_enrichments_per_month },
    unipile_accounts: { used: unipile, limit: capsRow.cap_unipile_accounts },
    llm_tokens: { used: llm, limit: capsRow.cap_llm_tokens_per_month },
    plan_tier: capsRow.plan_tier,
    billing_month: billingMonth.toISOString().slice(0, 7),
  };
}

/**
 * Convenience wrapper for LLM responses — pulls `input_tokens` and
 * `output_tokens` out of the Anthropic SDK response shape and logs the sum
 * as a single `llm_tokens` event. Falls back to 0 if the SDK shape changes.
 */
export function meterTokens(
  meterFor: { organisation_id: string; route: string } | undefined,
  response: { usage?: { input_tokens?: number; output_tokens?: number } } | null | undefined,
  modelHint?: string,
): void {
  if (!meterFor || !response?.usage) return;
  const input = response.usage.input_tokens ?? 0;
  const output = response.usage.output_tokens ?? 0;
  const total = input + output;
  if (total <= 0) return;
  void logEvent(meterFor.organisation_id, 'llm_tokens', total, {
    route: meterFor.route,
    model: modelHint,
    input_tokens: input,
    output_tokens: output,
  });
}

/**
 * Helper for API routes — returns a NextResponse 429 payload when blocked,
 * or null when the request can proceed.
 */
export function buildCapExceededResponse(
  event_type: UsageEventType,
  result: CapCheckResult,
): { cap_exceeded: true; event_type: UsageEventType; used: number; limit: number; plan_tier: string; reason: string } {
  return {
    cap_exceeded: true,
    event_type,
    used: result.used,
    limit: result.limit,
    plan_tier: result.plan_tier,
    reason: result.reason ?? 'cap reached',
  };
}
