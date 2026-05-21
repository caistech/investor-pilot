import { authenticateAndGetDb } from '@/lib/agent/db';
import { braveWebSearch } from '@/lib/agent/brave-tools';
import { searchLinkedInPeople, searchSalesNavigator, type LinkedInPerson } from '@/lib/channels/unipile';
import { upsertPartner, computeWeightedScore } from '@/lib/db/partners';
import { NextResponse } from 'next/server';
import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';
import { checkCap, buildCapExceededResponse, meterTokens } from '@/lib/usage/events';

type DiscoverSource = 'linkedin' | 'sales_nav' | 'brave';

interface DiscoveryCandidate {
  // Common shape across all sources, then scored by Claude.
  name: string;
  domain: string;
  description: string;
  source: DiscoverSource;
  // LinkedIn-sourced hits arrive with these already filled, no enrich needed:
  contact_name?: string;
  contact_title?: string;
  contact_linkedin?: string;
}

// Lender ICP scoring prompt (v3, 2026-05-13) — per Senior Debt Brief v3 Section 4.
// Schema field names retained from v2 (audience_overlap_score etc) to avoid migration;
// semantics rewritten for senior-debt lender channel. See docs/sprint-0/09-f2k-best-fit-profile-DRAFT.md.
// SCORING_PROMPT was hardcoded here (and duplicated in src/lib/discovery/scorer.ts)
// prior to Phase C of the multi-tenant config layer. Now built per-request from
// the product row via buildScoringPrompt() — see the resolveProductId branch
// below where scoringSystemPrompt is assembled before any scoring calls.
import { buildScoringPrompt, type ScoringPromptProduct } from '@/lib/pipeline/scoring-prompt';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const body = await request.json();
  let { product_id, project_id, organisation_id, query, domains, sources, linkedin_filters } = body as {
    product_id?: string;
    project_id?: string;
    organisation_id?: string;
    query?: string;
    domains?: string[];
    sources?: DiscoverSource[];
    linkedin_filters?: {
      title?: string;
      location?: string;
      current_company?: string;
      industry?: string;
      limit?: number;
      seniority?: string[];
      function?: string[];
      years_in_position?: string;
    };
  };

  // Auto-resolve org from authenticated user if not provided
  if (!organisation_id || organisation_id === 'auto') {
    const { data: profile } = await db
      .from('profiles')
      .select('active_organisation_id')
      .eq('id', user!.id)
      .single();
    organisation_id = profile?.active_organisation_id;
  }
  if (!organisation_id) {
    return NextResponse.json({ error: 'Could not resolve organisation' }, { status: 400 });
  }

  // Pre-flight cap check — block if Brave or LLM tokens are exhausted.
  const _orgId = organisation_id as string;
  const braveCap = await checkCap(_orgId, 'brave_query');
  if (!braveCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('brave_query', braveCap), { status: 429 });
  }
  const llmCap = await checkCap(_orgId, 'llm_tokens');
  if (!llmCap.allowed) {
    return NextResponse.json(buildCapExceededResponse('llm_tokens', llmCap), { status: 429 });
  }
  const meterFor = { organisation_id: _orgId, route: '/api/pipeline/discover' };

  // Resolve offering. Prefer project context when project_id is provided.
  let offeringName = '';
  let offeringDesc = '';
  let offeringICP = '';
  let resolvedProjectId: string | null = null;
  let resolvedProductId: string | null = null;

  if (project_id) {
    const { data: project } = await db
      .from('projects')
      .select('id, name, description, sponsor, funding_target, geography, asset_class, icp_company_size, icp_verticals, icp_buyer_title')
      .eq('id', project_id)
      .single();
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    resolvedProjectId = project.id;
    offeringName = project.name;
    offeringDesc = `${project.description || ''} Sponsor: ${project.sponsor || '—'}. Funding: ${project.funding_target || '—'}. Geography: ${project.geography || '—'}. Asset class: ${project.asset_class || '—'}.`;
    offeringICP = `${project.icp_company_size || ''} firms in ${project.icp_verticals || ''}, buyer: ${project.icp_buyer_title || ''}.`;
  } else {
    if (!product_id || product_id === 'auto') {
      const { data: firstProduct } = await db
        .from('products')
        .select('id')
        .eq('organisation_id', organisation_id)
        .limit(1)
        .single();
      product_id = firstProduct?.id;
    }
    if (!product_id) {
      return NextResponse.json({ error: 'No product or project found. Create one first.' }, { status: 400 });
    }
    resolvedProductId = product_id;
  }

  let productContext = '';
  let scoringSystemPrompt = '';
  if (resolvedProjectId) {
    productContext = `Offering: ${offeringName}. ${offeringDesc} ICP: ${offeringICP}`;
    // Project-driven discovery: try to score against the linked product's
    // ICP if there is one; otherwise the operator hasn't configured ICP and
    // we can't score. Project-level scoring rubrics are out of scope for
    // Phase C — track via /products page editing for now.
    const { data: linkedProduct } = await db
      .from('projects')
      .select('product_id')
      .eq('id', resolvedProjectId)
      .single();
    if (linkedProduct?.product_id) {
      resolvedProductId = linkedProduct.product_id;
    }
  } else if (resolvedProductId) {
    const { data: product } = await db
      .from('products')
      .select('name, one_sentence_description, icp_company_size, icp_verticals, icp_buyer_title')
      .eq('id', resolvedProductId)
      .single();
    productContext = product
      ? `Product: ${product.name}. ${product.one_sentence_description || ''}. ICP: ${product.icp_company_size || ''} companies in ${product.icp_verticals || ''}, buyer: ${product.icp_buyer_title || ''}.`
      : 'No product context available.';
  } else {
    productContext = 'No offering context available.';
  }

  if (resolvedProductId) {
    const { data: scoringProduct } = await db
      .from('products')
      .select('product_pitch, scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases, asset_class, geography')
      .eq('id', resolvedProductId)
      .single();
    if (scoringProduct) {
      try {
        scoringSystemPrompt = buildScoringPrompt(scoringProduct as ScoringPromptProduct);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 },
        );
      }
    }
  }
  if (!scoringSystemPrompt) {
    return NextResponse.json(
      { error: 'No scoring rubric configured for this product. Visit /settings to set scoring_rubric before running discovery.' },
      { status: 400 },
    );
  }

  const results: Array<{
    company_name: string;
    domain: string;
    status: string;
    weighted_score?: number;
    source?: DiscoverSource;
    error?: string;
  }> = [];

  // Resolve which sources to run. If caller didn't specify, prefer LinkedIn
  // when a channel is connected — this is the Affluent Connections methodology
  // primary engine; Brave is a supplement, not the default.
  if (!sources || sources.length === 0) {
    const { data: linkedinChannel } = await db
      .from('client_channels')
      .select('id')
      .eq('organisation_id', organisation_id)
      .eq('channel_type', 'linkedin')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    sources = linkedinChannel ? ['linkedin'] : ['brave'];
  }

  const candidates: DiscoveryCandidate[] = [];

  // Source: LinkedIn / Sales Navigator — search runs as the operator's
  // connected account via Unipile. Returns people directly (with profile URL),
  // so contact_linkedin is free and contact_name/title pre-populated.
  for (const source of sources) {
    if (source === 'linkedin' || source === 'sales_nav') {
      if (!query) continue; // Need a keyword query for LinkedIn search

      const { data: channel } = await db
        .from('client_channels')
        .select('oauth_token_ref')
        .eq('organisation_id', organisation_id)
        .eq('channel_type', 'linkedin')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (!channel?.oauth_token_ref) {
        results.push({
          company_name: '—',
          domain: '—',
          status: 'error',
          source,
          error: `${source} requested but no active LinkedIn channel connected`,
        });
        continue;
      }

      const liResult =
        source === 'sales_nav'
          ? await searchSalesNavigator({
              account_id: channel.oauth_token_ref,
              filters: { keywords: query, ...(linkedin_filters || {}) },
            })
          : await searchLinkedInPeople({
              account_id: channel.oauth_token_ref,
              filters: { keywords: query, ...(linkedin_filters || {}) },
            });

      if (!liResult.ok) {
        results.push({
          company_name: '—',
          domain: '—',
          status: 'error',
          source,
          error: liResult.error,
        });
        continue;
      }

      for (const person of liResult.people) {
        candidates.push(linkedInPersonToCandidate(person, source));
      }
    }

    if (source === 'brave' && query) {
      try {
        const searchResults = await braveWebSearch(query, 10, undefined, meterFor);
        for (const r of searchResults) {
          const url = new URL(r.url);
          candidates.push({
            name: r.title.split(' - ')[0].split(' | ')[0].trim(),
            domain: url.hostname.replace(/^www\./, ''),
            description: r.description,
            source: 'brave',
          });
        }
      } catch (err) {
        results.push({
          company_name: '—',
          domain: '—',
          status: 'error',
          source: 'brave',
          error: `Brave search failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Source: explicit domain seed list (always honoured, regardless of sources)
  if (domains && domains.length > 0) {
    for (const d of domains) {
      const clean = d.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (clean && !candidates.some(c => c.domain === clean)) {
        candidates.push({ name: clean, domain: clean, description: '', source: 'brave' });
      }
    }
  }

  // De-dupe by (domain || profile_url). LinkedIn-sourced hits beat Brave hits
  // for the same person because they bring contact_linkedin pre-attached.
  const seen = new Set<string>();
  const companies: DiscoveryCandidate[] = [];
  for (const c of candidates) {
    const key = (c.contact_linkedin || c.domain).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    companies.push(c);
  }

  if (companies.length === 0) {
    return NextResponse.json(
      { error: 'No candidates found. Provide a search query, domain list, or connect a LinkedIn channel.' },
      { status: 400 }
    );
  }

  // Score each candidate via one-shot Claude call
  for (const company of companies.slice(0, 20)) {
    try {
      // For LinkedIn-sourced hits, the person + role IS the signal — include
      // contact_name + contact_title in the scoring context so Claude can
      // weight authority (FO principal vs analyst) correctly.
      const personContext = company.contact_name
        ? `\nContact: ${company.contact_name}${company.contact_title ? ` — ${company.contact_title}` : ''}${company.contact_linkedin ? ` (${company.contact_linkedin})` : ''}`
        : '';

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: scoringSystemPrompt,
        messages: [{
          role: 'user',
          content: `${productContext}\n\nCandidate to score: ${company.name} (${company.domain})\nSource: ${company.source}${personContext}\nDescription: ${company.description || 'No description available'}`,
        }],
      });

      meterTokens(meterFor, response, MODEL);

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        results.push({ company_name: company.name, domain: company.domain, status: 'error', error: 'Invalid scoring response' });
        continue;
      }

      const scores = JSON.parse(jsonMatch[0]);
      const weightedScore = computeWeightedScore({
        audience_overlap: scores.audience_overlap_score || 0,
        complementarity: scores.complementarity_score || 0,
        partner_readiness: scores.partner_readiness_score || 0,
        reachability: scores.reachability_score || 0,
        strategic_leverage: scores.strategic_leverage_score || 0,
      });

      const result = await upsertPartner(db, {
        organisation_id,
        product_id: resolvedProductId,
        project_id: resolvedProjectId,
        company_name: company.name,
        domain: company.domain,
        category: scores.category || null,
        partner_type: scores.partner_type || 'referral',
        // LinkedIn-sourced hits land as contact_found because we have the
        // LinkedIn URL + role already — they only need email enrichment, not
        // contact discovery. Brave-sourced hits land as scored and require
        // the normal enrich step.
        status: company.source === 'linkedin' || company.source === 'sales_nav' ? 'contact_found' : 'scored',
        weighted_score: weightedScore,
        confidence_score: scores.confidence_score || 'normal',
        audience_overlap_score: scores.audience_overlap_score,
        audience_overlap_notes: scores.audience_overlap_notes,
        complementarity_score: scores.complementarity_score,
        complementarity_notes: scores.complementarity_notes,
        partner_readiness_score: scores.partner_readiness_score,
        partner_readiness_notes: scores.partner_readiness_notes,
        reachability_score: scores.reachability_score,
        reachability_notes: scores.reachability_notes,
        strategic_leverage_score: scores.strategic_leverage_score,
        strategic_leverage_notes: scores.strategic_leverage_notes,
        // Pre-populated from LinkedIn search (free; no Hunter step needed)
        contact_name: company.contact_name,
        contact_title: company.contact_title,
        contact_linkedin: company.contact_linkedin,
      });

      results.push({
        company_name: company.name,
        domain: company.domain,
        status: result.status,
        weighted_score: weightedScore,
        source: company.source,
        error: result.error,
      });
    } catch (err) {
      results.push({
        company_name: company.name,
        domain: company.domain,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    discovered: results.filter(r => r.status !== 'error').length,
    errors: results.filter(r => r.status === 'error').length,
    sources_used: sources,
    results,
  });
}

function linkedInPersonToCandidate(person: LinkedInPerson, source: DiscoverSource): DiscoveryCandidate {
  // Best-effort domain derivation. LinkedIn doesn't always return a website
  // field — fall back to a synthetic LinkedIn-keyed slug so the partner row
  // still upserts uniquely. The renderer/sender uses contact_linkedin, not
  // domain, so a synthetic value here doesn't affect outreach.
  const domainFromCompany = person.current_company_domain
    ? person.current_company_domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    : null;

  const domain = domainFromCompany || (person.public_id ? `linkedin.com/in/${person.public_id}` : `linkedin-unknown-${Math.random().toString(36).slice(2, 10)}`);

  const description = [
    person.headline,
    person.current_company ? `Current: ${person.current_company}` : null,
    person.location ? `Location: ${person.location}` : null,
    person.industry ? `Industry: ${person.industry}` : null,
  ].filter(Boolean).join(' · ');

  return {
    name: person.current_company || person.full_name,
    domain,
    description,
    source,
    contact_name: person.full_name || undefined,
    contact_title: person.headline || undefined,
    contact_linkedin: person.profile_url || undefined,
  };
}
