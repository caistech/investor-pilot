import { authenticateAndGetDb } from '@/lib/agent/db';
import { saveDraft } from '@/lib/db/partners';
import { getProductWebsiteUrl } from '@/lib/agent/sources';
import { NextResponse } from 'next/server';
import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import {
  buildDraftPrompt,
  buildInvestorDraftPrompt,
  type DraftPromptProduct,
  type InvestorDraftPromptProject,
} from '@/lib/pipeline/draft-prompt';
import { checkCap, buildCapExceededResponse, meterTokens } from '@/lib/usage/events';

export const maxDuration = 60;

// Wall-time guards. Default partner count is now batched 4-wide with per-call
// timeouts so an outlier Claude response can't block the whole request and
// push us past Vercel's 60s edge ceiling.
const MAX_PARTNERS_PER_REQUEST = 20;
const DRAFT_CONCURRENCY = 4;
const CLAUDE_TIMEOUT_MS = 8_000;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json() as {
    partner_ids: string[];
    organisation_id: string;
    product_id?: string | null;
    project_id?: string | null;
  };
  const { partner_ids, organisation_id, product_id, project_id } = body;

  if (!partner_ids?.length || !organisation_id || (!product_id && !project_id)) {
    return NextResponse.json(
      { error: 'partner_ids[], organisation_id, and one of (product_id, project_id) required' },
      { status: 400 },
    );
  }

  if (partner_ids.length > MAX_PARTNERS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many partners — pass at most ${MAX_PARTNERS_PER_REQUEST} per call (got ${partner_ids.length}). Split into batches to stay under the 60s function ceiling.`,
      },
      { status: 400 },
    );
  }

  // Pre-flight cap check — drafting is the most token-heavy stage.
  const llmCap = await checkCap(organisation_id, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }
  const meterFor = { organisation_id, route: '/api/pipeline/draft' };

  // Sender identity is shared across product/project branches.
  const { data: org } = await db
    .from('organisations')
    .select('sender_name, sender_role')
    .eq('id', organisation_id)
    .single();

  if (!org?.sender_name || !org?.sender_role) {
    return NextResponse.json(
      { error: 'Organisation has no sender identity configured. Visit /settings to set sender_name and sender_role before drafting.' },
      { status: 400 },
    );
  }

  // Branch on offering type. project_id wins when both are supplied —
  // partners in fundraising mode should always get the investor prompt.
  let draftSystemPrompt: string;
  let contextSummary: string;

  if (project_id) {
    const { data: project } = await db
      .from('projects')
      .select('name, sponsor, description, investment_thesis, target_round, round_size_label, asset_class, geography')
      .eq('id', project_id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    try {
      draftSystemPrompt = buildInvestorDraftPrompt(project as InvestorDraftPromptProject, {
        sender_name: org.sender_name,
        sender_role: org.sender_role,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }

    contextSummary = `Project: ${project.name}. ${project.description || ''}. Round: ${project.target_round || 'unspecified'}${project.round_size_label ? ` (${project.round_size_label})` : ''}.`;
  } else {
    const [{ data: product }, productUrl] = await Promise.all([
      db.from('products')
        .select('name, one_sentence_description, core_mechanism, customer_outcomes, product_pitch, facility_summary, asset_class, geography, ticket_size_min_label, ticket_size_max_label, draft_compliance_forbidden_terms')
        .eq('id', product_id!)
        .single(),
      getProductWebsiteUrl(product_id!),
    ]);

    try {
      draftSystemPrompt = buildDraftPrompt(product as DraftPromptProduct, {
        sender_name: org.sender_name,
        sender_role: org.sender_role,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }

    contextSummary = product
      ? `Product: ${product.name}. ${product.one_sentence_description || ''}. Core: ${product.core_mechanism || ''}. Outcomes: ${product.customer_outcomes || ''}.${productUrl ? ` Product website: ${productUrl}` : ''}`
      : '';
  }

  const productContext = contextSummary;

  // Load partners
  const { data: partners } = await db
    .from('partners')
    .select('id, company_name, domain, category, contact_name, contact_title, contact_email, weighted_score, audience_overlap_notes, complementarity_notes, partner_readiness_notes')
    .in('id', partner_ids)
    .eq('organisation_id', organisation_id);

  if (!partners?.length) {
    return NextResponse.json({ error: 'No partners found' }, { status: 404 });
  }

  const results: Array<{
    partner_id: string;
    company_name: string;
    status: string;
    subject?: string;
    error?: string;
  }> = [];

  // Parallel batches with per-call timeouts. Previously fully sequential —
  // for 20 partners × ~4s Claude that's 80s, well over Vercel's 60s edge
  // ceiling. 4-wide concurrency × ~4s per call = ~20s for 20 partners,
  // even with stragglers.
  type PartnerRow = NonNullable<typeof partners>[number];
  async function draftOne(partner: PartnerRow) {
    if (!partner.contact_email) {
      return {
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'skipped',
        error: 'No contact email',
      };
    }

    try {
      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: 500,
          system: draftSystemPrompt,
          messages: [{
            role: 'user',
            content: `${productContext}

Partner: ${partner.company_name} (${partner.domain})
Category: ${partner.category || 'Unknown'}
Contact: ${partner.contact_name || 'Unknown'}, ${partner.contact_title || 'Unknown'}
Score: ${partner.weighted_score || 'N/A'}
Audience overlap: ${partner.audience_overlap_notes || 'No notes'}
Complementarity: ${partner.complementarity_notes || 'No notes'}
Readiness: ${partner.partner_readiness_notes || 'No notes'}`,
          }],
        },
        { signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS) },
      );

      meterTokens(meterFor, response, MODEL);

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { partner_id: partner.id, company_name: partner.company_name, status: 'error', error: 'Invalid draft response' };
      }

      const draft = JSON.parse(jsonMatch[0]);

      await saveDraft(db!, organisation_id, partner.domain, {
        draft_subject: draft.subject,
        draft_body: draft.body,
        partnership_motion: draft.partnership_motion,
        selected_gtm_angle: draft.selected_gtm_angle,
      });

      return {
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'drafted',
        subject: draft.subject,
      };
    } catch (err) {
      await db!.from('partners').update({
        draft_status: 'none',
        last_updated_at: new Date().toISOString(),
      }).eq('id', partner.id);

      return {
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  for (let i = 0; i < partners.length; i += DRAFT_CONCURRENCY) {
    const slice = partners.slice(i, i + DRAFT_CONCURRENCY);
    const batch = await Promise.all(slice.map(draftOne));
    results.push(...batch);
  }

  return NextResponse.json({
    drafted: results.filter(r => r.status === 'drafted').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  });
}
