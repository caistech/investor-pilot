import Anthropic from '@anthropic-ai/sdk';
import type { Product, Partner, PipelineStage, StageResult } from '@/lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const PIPELINE_STAGES: PipelineStage[] = [
  'initialise', 'categories', 'search', 'screen',
  'score', 'browse', 'find_contact', 'enrich_email',
  'select_motion', 'draft', 'file_gmail', 'hunter_push',
];

export function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = PIPELINE_STAGES.indexOf(current);
  return idx < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[idx + 1] : null;
}

export function buildProductContext(product: Product): string {
  return `
PRODUCT: ${product.name}
${product.one_sentence_description || ''}

CORE MECHANISM: ${product.core_mechanism || 'Not specified'}
CUSTOMER OUTCOMES: ${product.customer_outcomes || 'Not specified'}

ICP:
- Company size: ${product.icp_company_size || 'Not specified'}
- Stage: ${product.icp_stage || 'Not specified'}
- Verticals: ${product.icp_verticals || 'Not specified'}
- Buyer title: ${product.icp_buyer_title || 'Not specified'}
- User title: ${product.icp_user_title || 'Not specified'}
- Stack tools: ${product.icp_stack_tools || 'Not specified'}

TRACTION:
- ARR: ${product.traction_arr || 'Not specified'}
- Customers: ${product.traction_customers || 'Not specified'}

PARTNER TYPES: ${product.partner_types || 'referral'}
EXCLUSIONS: ${product.exclusions || 'None specified'}
`.trim();
}

export async function runCategoriesStage(product: Product): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Based on this product profile, identify 5-8 categories of companies whose customers match the ICP. For each category, state in one sentence why the audience overlap exists.

${buildProductContext(product)}

Return as JSON array: [{"category": "...", "rationale": "..."}]`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const categories = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return {
      success: true,
      stage: 'categories',
      data: { categories },
      events: [{
        partner_id: null,
        event_type: 'categories_generated',
        event_data: { count: categories.length, categories },
      }],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'categories',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{
        partner_id: null,
        event_type: 'stage_error',
        event_data: { stage: 'categories', error: String(error) },
      }],
    };
  }
}

export async function runScoringStage(
  product: Product,
  candidates: Array<{ company_name: string; domain: string; category: string; description: string }>
): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Score each candidate partner on 5 dimensions for this product:

${buildProductContext(product)}

CANDIDATES:
${candidates.map((c, i) => `${i + 1}. ${c.company_name} (${c.domain}) - ${c.category}: ${c.description}`).join('\n')}

SCORING DIMENSIONS (each 1-10):
1. Audience Overlap (30%): How precisely do their clients match our ICP?
2. Complementarity (25%): Does referring our product make their service better?
3. Partner Readiness (20%): Evidence of partnership programs or referral behavior?
4. Reachability (15%): Can we find a named contact in the relevant role?
5. Strategic Leverage (10%): Distribution power into our ICP?

For each dimension, state the evidence found and whether it's observed or inferred.
If a dimension relies more on inference than observation, cap at 4/10.

Return JSON array: [{
  "company_name": "...",
  "domain": "...",
  "audience_overlap_score": N, "audience_overlap_notes": "...",
  "complementarity_score": N, "complementarity_notes": "...",
  "partner_readiness_score": N, "partner_readiness_notes": "...",
  "reachability_score": N, "reachability_notes": "...",
  "strategic_leverage_score": N, "strategic_leverage_notes": "...",
  "weighted_score": N,
  "confidence_score": "normal" | "low-confidence"
}]`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const scored = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return {
      success: true,
      stage: 'score',
      data: { scored_partners: scored },
      events: scored.map((s: Record<string, unknown>) => ({
        partner_id: null,
        event_type: 'partner_scored',
        event_data: { company_name: s.company_name, weighted_score: s.weighted_score },
      })),
    };
  } catch (error) {
    return {
      success: false,
      stage: 'score',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{
        partner_id: null,
        event_type: 'stage_error',
        event_data: { stage: 'score', error: String(error) },
      }],
    };
  }
}

export async function runDraftStage(
  product: Product,
  partner: Partner,
  evidence: string[]
): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Draft a partnership outreach email for the founder to review.

PRODUCT: ${product.name} - ${product.one_sentence_description}
PARTNER: ${partner.company_name} (${partner.domain})
MOTION: ${partner.partnership_motion || 'Exploratory partnerships call'}
GTM ANGLE: ${partner.selected_gtm_angle || 'Not defined'}
CONTACT: ${partner.contact_name || 'Unknown'}, ${partner.contact_title || 'Unknown'}

EVIDENCE FOUND DURING RESEARCH:
${evidence.length > 0 ? evidence.map((e, i) => `${i + 1}. ${e}`).join('\n') : 'No specific evidence found.'}

EMAIL RULES:
- Subject: specific and benefit-oriented. Not "Partnership Opportunity."
- Opening: one sentence grounded in observed evidence. If no evidence, use a direct neutral statement.
- Body: lead with what this means for THEIR clients, not for us.
- Ask: the specific partnership motion. One low-commitment next step only.
- Length: under 150 words.
- Tone: peer-to-peer, founder to senior BD lead.
- Signature: Dennis | Corporate AI Solutions | corporateaisolutions.com
- NEVER use: "I hope this finds you well", "synergy", "mutual benefit", "exciting opportunity"
- NEVER fabricate: client segments, service claims, recent hires, or strategic priorities

Return JSON: {"subject": "...", "body": "..."}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const draft = jsonMatch ? JSON.parse(jsonMatch[0]) : { subject: '', body: '' };

    return {
      success: true,
      stage: 'draft',
      data: { draft },
      events: [{
        partner_id: partner.id,
        event_type: 'draft_created',
        event_data: { subject: draft.subject },
      }],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'draft',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{
        partner_id: partner.id,
        event_type: 'stage_error',
        event_data: { stage: 'draft', error: String(error) },
      }],
    };
  }
}
