/**
 * Project Interview question set (funding side).
 *
 * Operator-led 2026-05-19. Mirrors the Product Interview pattern but
 * targets fundraising rhetoric: investor outreach (VC partner / private
 * credit principal / family office CIO / LP) is structurally different
 * from sales (buyer-led outreach). The question set forces the right
 * framing per dimension: structure-led for debt, traction-led for VC,
 * track-record-led for LP commits.
 *
 * 8 required questions + 1 optional. The interview-synthesizer Claude
 * call produces a structured Project profile the operator reviews in
 * the existing manual /projects form before saving.
 */

import type { InterviewQuestion } from '@/lib/products/interview-questions';

export const PROJECT_INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'raise',
    prompt: 'What are you raising capital for?',
    helper: 'Give the project a short name and one sentence on what the vehicle / deal / round is. "F2K Housing Development Fund II — a senior-secured construction debt facility for Australian modular builders" is the kind of single sentence to aim for.',
    approxLength: 'short',
    informsFields: ['name', 'description'],
  },
  {
    id: 'structure',
    prompt: 'What\'s the structure?',
    helper: 'Equity round (Pre-Seed / Seed / Series A-C), debt facility (senior secured / mezzanine), fund LP commitments, or something else? Include the total amount being raised and the typical ticket band per investor.',
    approxLength: 'medium',
    informsFields: ['funding_type', 'funding_target', 'project_type'],
  },
  {
    id: 'thesis',
    prompt: 'What\'s the investment thesis?',
    helper: 'Why does this make money? The operator-side reason this is worth allocating to. For debt: the coverage, the offtake, what makes the security strong. For equity: the wedge, the timing, the traction. Be specific — generic "huge market" theses get archived instantly.',
    approxLength: 'long',
    informsFields: ['core_mechanism', 'customer_outcomes'],
  },
  {
    id: 'sponsor',
    prompt: 'Who\'s the sponsor and what\'s their relevant track record?',
    helper: 'Your team, your operator-side credibility. Named past deliveries, exits, AUM under management, repeat investors. Allocators back people; this is the trust signal.',
    approxLength: 'medium',
    informsFields: ['sponsor'],
  },
  {
    id: 'asset_class',
    prompt: 'What asset class and geography?',
    helper: 'The mandate slice this fits: "Real estate debt — Australia" / "B2B SaaS — Southeast Asia" / "Climate-tech infrastructure — EU". Specific enough that an allocator can match it against their thesis in under five seconds.',
    approxLength: 'short',
    informsFields: ['asset_class', 'geography'],
  },
  {
    id: 'investor_type',
    prompt: 'What investor types are you targeting?',
    helper: 'Pick the personas: VC partner, private credit / debt principal, family office CIO, LP / institutional, strategic / corporate VC, angel syndicate. Include the decision-maker title at each (Partner, MD, Head of Credit, CIO, etc).',
    approxLength: 'medium',
    informsFields: ['partner_types', 'icp_buyer_title'],
  },
  {
    id: 'investor_profile',
    prompt: 'What\'s the right investor profile?',
    helper: 'Fund size / AUM range, stage of fund (deploying / late-cycle), sectors they typically invest in, geographic mandate. Used as the discovery filter when finding allocators — the more specific, the less wasted outreach.',
    approxLength: 'medium',
    informsFields: ['icp_company_size', 'icp_stage', 'icp_verticals'],
  },
  {
    id: 'proof',
    prompt: 'Name 2-3 concrete proof points.',
    helper: 'Real previous deals you\'ve closed, sponsor track-record numbers, named comparable transactions. Frame as "we did X for Y outcome" — not "our flagship fund". The allocator screens on prior performance, not on positioning. (Compliance reminder: no "guaranteed", "risk-free", or yield promises.)',
    approxLength: 'long',
    informsFields: ['traction_arr', 'traction_customers'],
  },
  {
    id: 'exclude',
    prompt: 'Who is NOT the right investor for this raise?',
    helper: 'Allocator types we should filter OUT during discovery — wrong mandate (e.g. SaaS investors for a real estate debt deal), wrong cheque size (LPs writing $50M+ for a $3M round), wrong jurisdiction. Saves wasted enrichment.',
    approxLength: 'medium',
    informsFields: ['exclusions'],
    optional: true,
  },
];
