/**
 * Pre-send compliance rule sets (v3 — senior debt lender channel).
 * Source of truth: docs/sprint-0/06-draft-linkedin-message.md + 07-draft-email-message.md.
 *
 * Each rule list is mode-keyed so future modes (e.g. 'finance_au_wholesale' for
 * the deferred junior-debt channel, 'finance_us' for future US expansion) can
 * coexist without code change.
 *
 * Rules are loaded at module init. Counsel can update the JSON config alongside
 * a sign-off doc in docs/sprint-0/legal-signoff-*.md without code redeployment
 * IF moved to a config file — currently inlined for simplicity. TODO: extract to
 * JSON when counsel cycle warrants.
 */

export type ComplianceMode = 'standard' | 'finance_au_wholesale' | 'finance_au_senior_debt' | 'finance_us' | 'research_outreach';

export interface ComplianceRule {
  pattern: RegExp;
  reason: string;
  action: 'block' | 'flag';
}

const SENIOR_DEBT_FORBIDDEN: ComplianceRule[] = [
  // Hype / risk-free language
  { pattern: /\bguarantee(d|s|ing)?\b/i, reason: 'No guarantee language in cold outreach', action: 'block' },
  { pattern: /\brisk[- ]free\b/i, reason: 'No risk-free claims', action: 'block' },
  { pattern: /\bno risk\b/i, reason: 'No no-risk claims', action: 'block' },
  { pattern: /\boutperform(ed|ing|s)?\b.*\d+%/i, reason: 'No specific outperformance claims', action: 'block' },
  { pattern: /\bdouble[- ]digit\b/i, reason: 'No double-digit return language', action: 'block' },
  { pattern: /\bhigh[- ](yield|return)\b/i, reason: 'No high-yield/return marketing language', action: 'block' },

  // Urgency / scarcity
  { pattern: /\b(exclusive|limited[- ](time|spots?|offer)|act now|today only|this week only)\b/i, reason: 'No urgency/scarcity language', action: 'block' },
  { pattern: /\b(buy now|act fast)\b/i, reason: 'No imperative urgency', action: 'block' },
  { pattern: /\bbest[- ]in[- ]class\b/i, reason: 'No best-in-class superlative', action: 'block' },

  // Tokenisation / crypto (Sec 5.7 — deferred, do not surface unprompted)
  { pattern: /\btokeni[sz](ed|ation)\b/i, reason: 'Tokenised fund deferred — only address if asked', action: 'block' },
  { pattern: /\bcrypto\b/i, reason: 'Crypto language out of scope for senior debt outreach', action: 'block' },
  { pattern: /\bblockchain\b/i, reason: 'Blockchain language out of scope for senior debt outreach', action: 'block' },
  { pattern: /\bRWA\b/i, reason: 'RWA terminology out of scope for senior debt outreach', action: 'block' },
  { pattern: /\bon[- ]chain\b/i, reason: 'On-chain terminology out of scope for senior debt outreach', action: 'block' },

  // Wrong audience model (lenders, not retail/advisors)
  { pattern: /\bretail (investor|client)/i, reason: 'Senior debt is wholesale-only — never reference retail', action: 'block' },
  { pattern: /\byour clients\b/i, reason: 'Lender IS principal — never reference "your clients"', action: 'block' },

  // AI-cliche banned phrases
  { pattern: /\bI hope (this|you|the email)\b.*\bwell\b/i, reason: 'AI-cliche opener banned', action: 'block' },
  { pattern: /\bsynergy\b/i, reason: 'Banned filler', action: 'block' },
  { pattern: /\bmutual benefit\b/i, reason: 'Banned filler', action: 'block' },
  { pattern: /\bexciting opportunity\b/i, reason: 'Banned filler', action: 'block' },
];

// Approved dollar figures per Senior Debt Brief v3. Update here when counsel
// signs off new figures — the soft-flag regex AND the operator-visible reason
// text are both built from this list, so they stay in sync.
const SENIOR_DEBT_APPROVED_DOLLAR_VALUES = [
  '16.2M', '2.5M', '18.7M', '25.15M', '21.15M', '500K', '200K', '17,730',
] as const;

// Escape the values for regex (the dots in "16.2M" matter; the comma in
// "17,730" is already regex-safe but we leave it as-is).
const APPROVED_DOLLAR_REGEX_BODY = SENIOR_DEBT_APPROVED_DOLLAR_VALUES
  .map(v => v.replace(/\./g, '\\.'))
  .join('|');

// Negative lookahead: match $ + figure, EXCEPT when the figure exactly equals
// one of the approved values followed by a word boundary. Before this fix the
// pattern matched every $ figure including the approved ones, generating
// false-positive flags on every cold DM in the queue.
const UNAPPROVED_DOLLAR_PATTERN = new RegExp(
  `\\$(?!(?:${APPROVED_DOLLAR_REGEX_BODY})\\b)\\d+([,.]?\\d+)?[KMB]?\\b`,
  'i',
);

const APPROVED_DOLLAR_REASON =
  `Verify $ figure against approved set (${SENIOR_DEBT_APPROVED_DOLLAR_VALUES.map(v => '$' + v).join(', ')})`;

const SENIOR_DEBT_SOFT_FLAG: ComplianceRule[] = [
  // Rate quotes outside the IM-approved figures
  // Approved: 8.5%, 8.0%, 8-8.5%, 8-11% (range from brief Sec 4)
  // Pattern flags anything else
  { pattern: /\b(?!8\.?[05]%|8-(8\.5|11)%)\d+(\.\d+)?%\b/i, reason: 'Unapproved % rate — counsel approved only 8.5% Branscombe, 8.0% Seafields, 8-11% range', action: 'flag' },

  // Dollar amounts NOT in the approved set
  { pattern: UNAPPROVED_DOLLAR_PATTERN, reason: APPROVED_DOLLAR_REASON, action: 'flag' },

  // Stamford / Front — per Sec 5.5, soft framing in cold; never volunteer
  { pattern: /\bstamford\b/i, reason: 'Per Sec 5.5: Stamford reference only in conversation, not cold outreach', action: 'flag' },
  { pattern: /\bfront financial\b/i, reason: 'Per Sec 5.5: Front Financial reference only in conversation', action: 'flag' },

  // AFSL — pending counsel sign-off (Sec 5.8)
  { pattern: /\bAFSL\b/i, reason: 'AFSL framing pending counsel sign-off per Sec 5.8', action: 'flag' },

  // Advisor language — wrong audience (v2 leftover risk)
  { pattern: /\badvisor\b/i, reason: 'Wrong audience — this is direct lender outreach (v3), not advisor outreach', action: 'flag' },
  { pattern: /\badvis(e|ory)\b/i, reason: 'Advisory framing wrong audience for v3', action: 'flag' },
];

const STANDARD_FORBIDDEN: ComplianceRule[] = [
  { pattern: /\bguarantee(d|s)?\b/i, reason: 'No guarantee language', action: 'block' },
  { pattern: /\brisk[- ]free\b/i, reason: 'No risk-free claims', action: 'block' },
];

// Research-outreach mode (CAS distributor-discovery methodology — Session 1 plumbing).
// Designed for question-asking research messages, not pitch. Blocks any financial
// promise (you'd accidentally make one if you reused a finance template here) and
// any pitch-language patterns. Session 2 may refine the ruleset as classification
// surfaces what kinds of messages get the best response rates.
const RESEARCH_OUTREACH_FORBIDDEN: ComplianceRule[] = [
  { pattern: /\bguarantee(d|s)?\b/i, reason: 'Research outreach asks questions; never makes guarantees', action: 'block' },
  { pattern: /\brisk[- ]free\b/i, reason: 'Research outreach makes no claims', action: 'block' },
  { pattern: /\binvest(ment)?\b.*\b(return|opportunity|product)\b/i, reason: 'Research outreach is not an investment pitch', action: 'block' },
  { pattern: /\bexclusive (offer|opportunity|access)\b/i, reason: 'Research outreach has no offer — it asks for input', action: 'block' },
  { pattern: /\b(buy|purchase|order|subscribe) (now|today)\b/i, reason: 'Research outreach has no transaction', action: 'block' },
  // AI-cliche openers
  { pattern: /\bI hope (this|you|the email)\b.*\bwell\b/i, reason: 'AI-cliche opener banned', action: 'block' },
];

const RULES: Record<ComplianceMode, { forbidden: ComplianceRule[]; softFlag: ComplianceRule[] }> = {
  finance_au_senior_debt: {
    forbidden: SENIOR_DEBT_FORBIDDEN,
    softFlag: SENIOR_DEBT_SOFT_FLAG,
  },
  finance_au_wholesale: {
    // Reserved for future re-opening of $125K wholesale junior-debt channel
    forbidden: SENIOR_DEBT_FORBIDDEN,
    softFlag: SENIOR_DEBT_SOFT_FLAG,
  },
  finance_us: {
    // Reserved for future US Reg D expansion
    forbidden: STANDARD_FORBIDDEN,
    softFlag: [],
  },
  standard: {
    forbidden: STANDARD_FORBIDDEN,
    softFlag: [],
  },
  research_outreach: {
    forbidden: RESEARCH_OUTREACH_FORBIDDEN,
    softFlag: [],
  },
};

export function getRules(mode: ComplianceMode) {
  return RULES[mode] || RULES.standard;
}
