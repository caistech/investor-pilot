import Anthropic from '@anthropic-ai/sdk';
import type { Product, Partner, PipelineStage, StageResult } from '@/lib/types';
import { braveWebSearch } from './brave-tools';
import { hunterEmailFinder, hunterDomainSearch } from './hunter-tools';

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

export function buildProductContext(product: Product, sourceContent?: string): string {
  let context = `
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

  if (sourceContent) {
    context += `\n\nADDITIONAL PRODUCT KNOWLEDGE (from uploaded collateral):\n${sourceContent}`;
  }

  return context;
}

export async function runCategoriesStage(product: Product, sourceContent?: string): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Based on this product profile, identify 5-8 categories of companies whose customers match the ICP. For each category, state in one sentence why the audience overlap exists.

${buildProductContext(product, sourceContent)}

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

// --- SCORE STAGE (per-partner) ---
// Scores a single candidate on 5 dimensions
export async function runScoreForPartner(
  product: Product,
  candidate: { company_name: string; domain: string; category: string; description: string }
): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Score this candidate partner on 5 dimensions for this product:

${buildProductContext(product)}

CANDIDATE: ${candidate.company_name} (${candidate.domain}) - ${candidate.category}: ${candidate.description}

SCORING DIMENSIONS (each 1-10):
1. Audience Overlap (30%): How precisely do their clients match our ICP?
2. Complementarity (25%): Does referring our product make their service better?
3. Partner Readiness (20%): Evidence of partnership programs or referral behavior?
4. Reachability (15%): Can we find a named contact in the relevant role?
5. Strategic Leverage (10%): Distribution power into our ICP?

For each dimension, state the evidence found and whether it's observed or inferred.
If a dimension relies more on inference than observation, cap at 4/10.

Return JSON object: {
  "company_name": "...",
  "domain": "...",
  "audience_overlap_score": N, "audience_overlap_notes": "...",
  "complementarity_score": N, "complementarity_notes": "...",
  "partner_readiness_score": N, "partner_readiness_notes": "...",
  "reachability_score": N, "reachability_notes": "...",
  "strategic_leverage_score": N, "strategic_leverage_notes": "...",
  "weighted_score": N,
  "confidence_score": "normal" | "low-confidence"
}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const scored = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!scored) {
      return {
        success: false,
        stage: 'score',
        data: {},
        error: `Failed to parse scoring response for ${candidate.company_name}`,
        events: [{ partner_id: null, event_type: 'stage_error', event_data: { stage: 'score', error: 'JSON parse failed' } }],
      };
    }

    return {
      success: true,
      stage: 'score',
      data: { scored_partner: scored },
      events: [{
        partner_id: null,
        event_type: 'partner_scored',
        event_data: { company_name: scored.company_name, weighted_score: scored.weighted_score },
      }],
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

// --- SEARCH STAGE (per-category) ---
// Searches Brave for 3-5 candidates for a single category
export async function runSearchForCategory(
  product: Product,
  category: { category: string; rationale: string }
): Promise<StageResult> {
  try {
    const queries = [
      `${category.category} R&D tax incentive Australia`,
      `${category.category} startup clients Australia`,
    ];

    const searchResults = [];
    for (const q of queries) {
      const results = await braveWebSearch(q, 5);
      searchResults.push(...results);
    }

    // Ask Claude to extract company candidates from search results
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `From these search results, extract 3-5 specific companies that fit the category "${category.category}" and could be partner candidates for this product:

${buildProductContext(product)}

CATEGORY RATIONALE: ${category.rationale}

SEARCH RESULTS:
${searchResults.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.description}`).join('\n\n')}

Extract real companies only. Do not invent companies not present in results.
Return JSON array: [{"company_name": "...", "domain": "...", "description": "one line about what they do", "search_url": "source URL"}]`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const candidates = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    const tagged = candidates.map((c: Record<string, string>) => ({ ...c, category: category.category }));

    return {
      success: true,
      stage: 'search',
      data: { candidates: tagged },
      events: [{
        partner_id: null,
        event_type: 'category_searched',
        event_data: {
          category: category.category,
          count: tagged.length,
          candidates: tagged.map((c: Record<string, string>) => ({ company_name: c.company_name, domain: c.domain })),
        },
      }],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'search',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{ partner_id: null, event_type: 'stage_error', event_data: { stage: 'search', error: String(error) } }],
    };
  }
}

// --- SCREEN STAGE (per-batch) ---
// Screens a batch of candidates for partnership fit
export async function runScreenBatch(
  product: Product,
  candidates: Array<{ company_name: string; domain: string; category: string; description: string }>
): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `Screen these candidates for partnership fit. Flag or eliminate any that match:
- Direct competitor (offers R&D record-keeping or claim automation)
- ICP size mismatch (only serves ASX200 or only sole traders)
- Closed ecosystem (no referral history, no partner page signal)
- Stage mismatch (too large to prioritize a relationship with us)
- Geography mismatch (not Australian-focused)

${buildProductContext(product)}

CANDIDATES:
${candidates.map((c, i) => `${i + 1}. ${c.company_name} (${c.domain}) - ${c.category}: ${c.description}`).join('\n')}

Return JSON: {
  "passed": [{"company_name": "...", "domain": "...", "category": "...", "description": "..."}],
  "screened_out": [{"company_name": "...", "domain": "...", "reason": "..."}]
}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { passed: candidates, screened_out: [] };

    return {
      success: true,
      stage: 'screen',
      data: result,
      events: [
        ...result.screened_out.map((s: { company_name: string; reason: string }) => ({
          partner_id: null,
          event_type: 'candidate_screened_out',
          event_data: { company_name: s.company_name, reason: s.reason },
        })),
      ],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'screen',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{ partner_id: null, event_type: 'stage_error', event_data: { stage: 'screen', error: String(error) } }],
    };
  }
}

// --- BROWSE STAGE (per-partner) ---
// Research a single company via Brave Search to gather evidence for scoring
export async function runBrowseForPartner(
  candidate: { company_name: string; domain: string; category: string; description: string }
): Promise<StageResult> {
  try {
    const searchQueries = [
      `site:${candidate.domain}`,
      `${candidate.company_name} partnerships referral program`,
      `${candidate.company_name} team leadership`,
    ];

    const allResults = [];
    for (const q of searchQueries) {
      try {
        const results = await braveWebSearch(q, 5);
        allResults.push(...results);
      } catch {
        // Continue on individual search failures
      }
    }

    const enriched = {
      ...candidate,
      research: allResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })),
      pages_checked: searchQueries.length,
    };

    return {
      success: true,
      stage: 'browse',
      data: { browsed_candidate: enriched },
      events: [{
        partner_id: null,
        event_type: 'company_researched',
        event_data: {
          company_name: enriched.company_name,
          domain: enriched.domain,
          results_found: enriched.research.length,
        },
      }],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'browse',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{ partner_id: null, event_type: 'stage_error', event_data: { stage: 'browse', error: String(error) } }],
    };
  }
}

// --- FIND CONTACT (single partner) ---
// Uses Claude + Hunter.io to find the right contact for a single partner
export async function runFindContactForPartner(
  product: Product,
  partner: {
    company_name: string;
    domain: string;
    partnership_motion?: string;
    research?: Array<{ title: string; url: string; snippet: string }>;
  }
): Promise<StageResult> {
  try {
    // Ask Claude to identify the target role from research
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `For a ${partner.partnership_motion || 'referral partnership'} with ${partner.company_name}, who should we contact?

Research found:
${(partner.research || []).map((r) => `- ${r.title}: ${r.snippet}`).join('\n') || 'No research available.'}

Rules:
- Referral → head of partnerships, BD lead, practice manager, director
- Integration → product partnerships, integrations lead
- Company <20 employees → founder or managing director
- Fallback → most senior BD or partnerships title

Return JSON: {"target_role": "...", "identified_name": "..." or null, "identified_title": "..." or null}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const target = jsonMatch ? JSON.parse(jsonMatch[0]) : { target_role: 'Director', identified_name: null };

    let contactRecord: {
      company_name: string;
      domain: string;
      contact_name: string | null;
      contact_title: string | null;
      contact_email: string | null;
      contact_linkedin: string | null;
      email_confidence: number | null;
      email_status: string;
      contact_source: string;
    } = {
      company_name: partner.company_name,
      domain: partner.domain,
      contact_name: target.identified_name || null,
      contact_title: target.identified_title || target.target_role,
      contact_email: null,
      contact_linkedin: null,
      email_confidence: null,
      email_status: 'unresolved',
      contact_source: 'none',
    };

    // Try Hunter Email Finder if we have a name
    if (target.identified_name) {
      const nameParts = target.identified_name.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');

      if (firstName && lastName) {
        const emailResult = await hunterEmailFinder(partner.domain, firstName, lastName);
        if (emailResult) {
          contactRecord = {
            ...contactRecord,
            contact_name: `${emailResult.first_name} ${emailResult.last_name}`,
            contact_title: emailResult.position || contactRecord.contact_title,
            contact_email: emailResult.email,
            contact_linkedin: emailResult.linkedin,
            email_confidence: emailResult.confidence,
            email_status: emailResult.confidence >= 70 ? 'verified' : 'probable',
            contact_source: 'hunter_email_finder',
          };
        }
      }
    }

    // Fallback to Hunter Domain Search
    if (!contactRecord.contact_email) {
      const domainResult = await hunterDomainSearch(partner.domain);
      if (domainResult && domainResult.emails.length > 0) {
        const bestMatch = domainResult.emails
          .filter((e) => e.confidence >= 30)
          .sort((a, b) => b.confidence - a.confidence)[0];

        if (bestMatch) {
          const name = [bestMatch.first_name, bestMatch.last_name].filter(Boolean).join(' ') || null;
          contactRecord = {
            ...contactRecord,
            contact_name: name || contactRecord.contact_name,
            contact_title: bestMatch.position || contactRecord.contact_title,
            contact_email: bestMatch.value,
            contact_linkedin: bestMatch.linkedin,
            email_confidence: bestMatch.confidence,
            email_status: name ? 'probable' : 'company_level',
            contact_source: 'hunter_domain_search',
          };
        }
      }
    }

    return {
      success: true,
      stage: 'find_contact',
      data: { contact: contactRecord },
      events: [{
        partner_id: null,
        event_type: 'contact_found',
        event_data: {
          company_name: contactRecord.company_name,
          contact_name: contactRecord.contact_name,
          email_status: contactRecord.email_status,
          email_confidence: contactRecord.email_confidence,
        },
      }],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'find_contact',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{
        partner_id: null,
        event_type: 'stage_error',
        event_data: { stage: 'find_contact', company_name: partner.company_name, error: String(error) },
      }],
    };
  }
}

// --- FIND CONTACT STAGE (batch — kept for backward compat) ---
// Uses Hunter.io to find the right contact for each partner
export async function runFindContactStage(
  product: Product,
  partners: Array<{
    company_name: string;
    domain: string;
    partnership_motion?: string;
    research?: Array<{ title: string; url: string; snippet: string }>;
  }>
): Promise<StageResult> {
  try {
    const contactResults = [];

    for (const partner of partners) {
      // First, ask Claude to identify the target role from research
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `For a ${partner.partnership_motion || 'referral partnership'} with ${partner.company_name}, who should we contact?

Research found:
${(partner.research || []).map((r) => `- ${r.title}: ${r.snippet}`).join('\n') || 'No research available.'}

Rules:
- Referral → head of partnerships, BD lead, practice manager, director
- Integration → product partnerships, integrations lead
- Company <20 employees → founder or managing director
- Fallback → most senior BD or partnerships title

Return JSON: {"target_role": "...", "identified_name": "..." or null, "identified_title": "..." or null}`,
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const target = jsonMatch ? JSON.parse(jsonMatch[0]) : { target_role: 'Director', identified_name: null };

      let contactRecord: {
        company_name: string;
        domain: string;
        contact_name: string | null;
        contact_title: string | null;
        contact_email: string | null;
        contact_linkedin: string | null;
        email_confidence: number | null;
        email_status: string;
        contact_source: string;
      } = {
        company_name: partner.company_name,
        domain: partner.domain,
        contact_name: target.identified_name || null,
        contact_title: target.identified_title || target.target_role,
        contact_email: null,
        contact_linkedin: null,
        email_confidence: null,
        email_status: 'unresolved',
        contact_source: 'none',
      };

      // Try Hunter Email Finder if we have a name
      if (target.identified_name) {
        const nameParts = target.identified_name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        if (firstName && lastName) {
          const emailResult = await hunterEmailFinder(partner.domain, firstName, lastName);
          if (emailResult) {
            contactRecord = {
              ...contactRecord,
              contact_name: `${emailResult.first_name} ${emailResult.last_name}`,
              contact_title: emailResult.position || contactRecord.contact_title,
              contact_email: emailResult.email,
              contact_linkedin: emailResult.linkedin,
              email_confidence: emailResult.confidence,
              email_status: emailResult.confidence >= 70 ? 'verified' : 'probable',
              contact_source: 'hunter_email_finder',
            };
          }
        }
      }

      // Fallback to Hunter Domain Search
      if (!contactRecord.contact_email) {
        const domainResult = await hunterDomainSearch(partner.domain);
        if (domainResult && domainResult.emails.length > 0) {
          // Find best match by role relevance
          const bestMatch = domainResult.emails
            .filter((e) => e.confidence >= 30)
            .sort((a, b) => b.confidence - a.confidence)[0];

          if (bestMatch) {
            const name = [bestMatch.first_name, bestMatch.last_name].filter(Boolean).join(' ') || null;
            contactRecord = {
              ...contactRecord,
              contact_name: name || contactRecord.contact_name,
              contact_title: bestMatch.position || contactRecord.contact_title,
              contact_email: bestMatch.value,
              contact_linkedin: bestMatch.linkedin,
              email_confidence: bestMatch.confidence,
              email_status: name ? 'probable' : 'company_level',
              contact_source: 'hunter_domain_search',
            };
          }
        }
      }

      contactResults.push(contactRecord);
    }

    return {
      success: true,
      stage: 'find_contact',
      data: { contacts: contactResults },
      events: contactResults.map((c) => ({
        partner_id: null,
        event_type: 'contact_found',
        event_data: {
          company_name: c.company_name,
          contact_name: c.contact_name,
          email_status: c.email_status,
          email_confidence: c.email_confidence,
        },
      })),
    };
  } catch (error) {
    return {
      success: false,
      stage: 'find_contact',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{ partner_id: null, event_type: 'stage_error', event_data: { stage: 'find_contact', error: String(error) } }],
    };
  }
}

// --- SELECT MOTION STAGE (per-partner) ---
// Determines the best partnership motion for a single partner
export async function runSelectMotionForPartner(
  product: Product,
  partner: {
    company_name: string;
    domain: string;
    weighted_score: number;
    partner_readiness_score: number;
    confidence_score: string;
    contact_name?: string | null;
    contact_title?: string | null;
  }
): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Select the most credible first partnership motion and propose a GTM angle for this partner.

${buildProductContext(product)}

PARTNER: ${partner.company_name} (${partner.domain}) — score: ${partner.weighted_score}, readiness: ${partner.partner_readiness_score}/10, confidence: ${partner.confidence_score}, contact: ${partner.contact_name || 'unknown'} (${partner.contact_title || 'unknown'})

MOTION OPTIONS:
- Referral arrangement discussion
- Integration discovery conversation
- Co-marketing test
- Marketplace or ecosystem listing
- Exploratory partnerships call

RULES:
- Tier 1 readiness (8-10) → specific motion, not generic exploratory
- Low readiness → lighter, conversational opener
- Select a GTM angle grounded in evidence

Return a single JSON object (not an array): {"partnership_motion": "...", "selected_gtm_angle": "...", "motion_rationale": "one sentence why"}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const motion = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      success: true,
      stage: 'select_motion',
      data: {
        motion: {
          company_name: partner.company_name,
          domain: partner.domain,
          partnership_motion: motion.partnership_motion || 'Exploratory partnerships call',
          selected_gtm_angle: motion.selected_gtm_angle || '',
          motion_rationale: motion.motion_rationale || '',
        },
      },
      events: [{
        partner_id: null,
        event_type: 'motion_selected',
        event_data: {
          company_name: partner.company_name,
          partnership_motion: motion.partnership_motion,
          gtm_angle: motion.selected_gtm_angle,
        },
      }],
    };
  } catch (error) {
    return {
      success: false,
      stage: 'select_motion',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{
        partner_id: null,
        event_type: 'stage_error',
        event_data: { stage: 'select_motion', company_name: partner.company_name, error: String(error) },
      }],
    };
  }
}

// --- SELECT MOTION STAGE (batch - legacy) ---
// Determines the best partnership motion for each partner
export async function runSelectMotionStage(
  product: Product,
  partners: Array<{
    company_name: string;
    domain: string;
    weighted_score: number;
    partner_readiness_score: number;
    confidence_score: string;
    contact_name?: string | null;
    contact_title?: string | null;
  }>
): Promise<StageResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `For each partner, select the most credible first partnership motion and propose a GTM angle.

${buildProductContext(product)}

PARTNERS:
${partners.map((p, i) => `${i + 1}. ${p.company_name} (${p.domain}) — score: ${p.weighted_score}, readiness: ${p.partner_readiness_score}/10, confidence: ${p.confidence_score}, contact: ${p.contact_name || 'unknown'} (${p.contact_title || 'unknown'})`).join('\n')}

MOTION OPTIONS:
- Referral arrangement discussion
- Integration discovery conversation
- Co-marketing test
- Marketplace or ecosystem listing
- Exploratory partnerships call

RULES:
- Tier 1 readiness (8-10) → specific motion, not generic exploratory
- Low readiness → lighter, conversational opener
- Select a GTM angle grounded in evidence

Return JSON array: [{
  "company_name": "...",
  "domain": "...",
  "partnership_motion": "...",
  "selected_gtm_angle": "...",
  "motion_rationale": "one sentence why"
}]`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const motions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return {
      success: true,
      stage: 'select_motion',
      data: { motions },
      events: motions.map((m: Record<string, unknown>) => ({
        partner_id: null,
        event_type: 'motion_selected',
        event_data: {
          company_name: m.company_name,
          partnership_motion: m.partnership_motion,
          gtm_angle: m.selected_gtm_angle,
        },
      })),
    };
  } catch (error) {
    return {
      success: false,
      stage: 'select_motion',
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [{ partner_id: null, event_type: 'stage_error', event_data: { stage: 'select_motion', error: String(error) } }],
    };
  }
}
