/**
 * Pre-send compliance filter (audience-agnostic framework, v3-tuned rules).
 *
 * Two-layer check:
 *   1. Regex pass against forbidden + soft-flag rules (fast, deterministic)
 *   2. LLM pass for context-aware checks (slower, optional — Sprint 1 deliverable)
 *
 * Returns { pass, flags, blocked } so the approval queue can surface results
 * inline with the message preview (green / yellow / red per file 06 spec).
 */

import { getRules, type ComplianceMode } from './rules';

export interface ComplianceFlag {
  level: 'block' | 'flag';
  reason: string;
  match: string; // the substring that triggered the rule
}

export interface ComplianceResult {
  pass: boolean; // true if no 'block'-level flags
  blocked: boolean; // true if any 'block'-level flag
  flags: ComplianceFlag[];
  mode: ComplianceMode;
  checked_at: string;
}

/**
 * Run regex-layer compliance check against the configured rule set.
 * Pure synchronous function — no API calls.
 */
export function checkCompliance(text: string, mode: ComplianceMode = 'finance_au_senior_debt'): ComplianceResult {
  const rules = getRules(mode);
  const flags: ComplianceFlag[] = [];

  for (const rule of rules.forbidden) {
    const match = text.match(rule.pattern);
    if (match) {
      flags.push({ level: 'block', reason: rule.reason, match: match[0] });
    }
  }

  for (const rule of rules.softFlag) {
    const match = text.match(rule.pattern);
    if (match) {
      flags.push({ level: 'flag', reason: rule.reason, match: match[0] });
    }
  }

  const blocked = flags.some(f => f.level === 'block');

  return {
    pass: !blocked,
    blocked,
    flags,
    mode,
    checked_at: new Date().toISOString(),
  };
}

/**
 * LLM-layer compliance check (TODO Sprint 1 — currently no-op stub).
 *
 * The LLM check catches context-dependent issues the regex misses:
 *   - "We typically deliver returns in the 8-11% range" — regex passes (8-11% is approved),
 *     but LLM should note this implies a forward-looking guarantee.
 *   - Lender impersonation / phishing-style patterns.
 *   - Subtle anti-hawking language.
 *
 * Implementation pattern: one-shot Claude call returning {pass: bool, flags: []}.
 * Loaded from compliance_mode-specific system prompt.
 */
export async function checkComplianceLLM(
  text: string,
  mode: ComplianceMode = 'finance_au_senior_debt'
): Promise<ComplianceResult> {
  // Stub — returns clean for now. Sprint 1 task: wire to Claude one-shot
  // with mode-specific system prompt loaded from docs/sprint-0/06+07 rules.
  return {
    pass: true,
    blocked: false,
    flags: [],
    mode,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Combined check: regex first, then LLM if regex passes.
 * Most calls should use this.
 */
export async function checkComplianceFull(
  text: string,
  mode: ComplianceMode = 'finance_au_senior_debt'
): Promise<ComplianceResult> {
  const regex = checkCompliance(text, mode);
  if (regex.blocked) return regex;

  const llm = await checkComplianceLLM(text, mode);
  return {
    pass: regex.pass && llm.pass,
    blocked: regex.blocked || llm.blocked,
    flags: [...regex.flags, ...llm.flags],
    mode,
    checked_at: new Date().toISOString(),
  };
}
