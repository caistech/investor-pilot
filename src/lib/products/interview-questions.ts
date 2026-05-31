/**
 * Product Interview question set.
 *
 * Operator-approved 2026-05-19 as the structured Q&A flow at the front of
 * product setup. Each question is benefit-framed so operators can't
 * accidentally produce the "MMC Build is our flagship modular platform"
 * mis-positioning that bit us in the wild — the question structure forces
 * the right relationship between the sender and their case studies.
 *
 * 9 required questions + 1 optional. The interview-synthesizer Claude call
 * takes the answers and produces a structured 14-field product profile the
 * operator reviews in the existing manual form before saving.
 *
 * 2026-05-31: added the `geography` question. Discovery's query generator
 * defaults to US markets when geography is empty (see query-generator.ts
 * STEP 3 geography rule), so an operator targeting a specific country who
 * never stated it silently got a US-skewed pool. Asking for it explicitly
 * lets the synthesizer populate products.geography, which runDiscoveryBatch
 * now passes through to the query generator.
 */

export interface InterviewQuestion {
  id: string;
  prompt: string;
  helper: string;
  /** Approx character count guidance for the operator. Not enforced — just a UI hint. */
  approxLength: 'short' | 'medium' | 'long';
  /** Which product fields this answer primarily informs. For UI traceability only — synthesis is LLM-driven, not field-mapped. */
  informsFields: string[];
  optional?: boolean;
}

export const PRODUCT_INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'what',
    prompt: 'What do you want to sell?',
    helper: 'Give it a short name and one sentence of what it is. A name + a one-liner — that\'s all this step needs.',
    approxLength: 'short',
    informsFields: ['name', 'one_sentence_description'],
  },
  {
    id: 'benefit',
    prompt: 'In one or two sentences, what changes for your customer after they work with you?',
    helper: 'Focus on the benefit they get, not the features of what you build. "After 90 days they have X" beats "we deliver Y feature".',
    approxLength: 'medium',
    informsFields: ['customer_outcomes', 'one_sentence_description'],
  },
  {
    id: 'pain',
    prompt: 'What pain point are you relieving?',
    helper: 'What\'s broken, slow, costly, or risky for the customer that you fix? Be concrete — the specific friction, not "operational inefficiency".',
    approxLength: 'medium',
    informsFields: ['customer_outcomes', 'core_mechanism'],
  },
  {
    id: 'how',
    prompt: 'How do you deliver it?',
    helper: 'What\'s your repeatable approach — fixed-price project, retainer, SaaS subscription, productised consultancy? Include any structural details (timeframe, format, what the customer commits to).',
    approxLength: 'medium',
    informsFields: ['core_mechanism'],
  },
  {
    id: 'buyer',
    prompt: 'Who\'s the buyer?',
    helper: 'Job title of the decision-maker — the person who controls budget and signs off. If the person who USES what you build is different from the buyer, mention both.',
    approxLength: 'short',
    informsFields: ['icp_buyer_title', 'icp_user_title'],
  },
  {
    id: 'size',
    prompt: 'What size and stage of business is the right fit?',
    helper: 'Employee band (e.g. 10-500), revenue range, growth stage (operating / scaling / pre-revenue). The more specific, the better the prospecting filter.',
    approxLength: 'short',
    informsFields: ['icp_company_size', 'icp_stage'],
  },
  {
    id: 'geography',
    prompt: 'Where are the businesses you want to reach?',
    helper: 'The countries, regions, or cities your ideal customers operate in (e.g. "Australia", "US & Canada", "UK and Ireland", "Sydney and Melbourne"). If you genuinely sell anywhere, say "global" — but a specific market gives a much sharper prospecting filter. Leaving this vague defaults prospecting to the US.',
    approxLength: 'short',
    informsFields: ['geography'],
  },
  {
    id: 'verticals',
    prompt: 'Which industries are you best at serving?',
    helper: 'List the industries. If one matters more than the others — because you\'ve delivered more there or it converts better — call that out explicitly. Order matters.',
    approxLength: 'medium',
    informsFields: ['icp_verticals'],
  },
  {
    id: 'proof',
    prompt: 'Name 2-3 concrete proof points.',
    helper: 'Real engagements you can talk about. Be specific: "we built X for Y client — Z result." Frame X as a client deliverable, not as your flagship product. (If X is genuinely your own product line, say so explicitly here.)',
    approxLength: 'long',
    informsFields: ['traction_arr', 'traction_customers'],
  },
  {
    id: 'exclude',
    prompt: 'Who is NOT a good fit?',
    helper: 'Buyers we should filter OUT during prospecting. Wrong company size, wrong tech maturity, businesses with in-house teams that compete with what you offer. Saves wasted enrichment spend.',
    approxLength: 'medium',
    informsFields: ['exclusions'],
    optional: true,
  },
];