/**
 * POST /api/agent/autofill-project
 *
 * Project-aware autofill. Reads the project's Knowledge Base + optional
 * URL/text seed and asks Claude to extract:
 *   - description (the elevator pitch FOR the capital provider)
 *   - funding_target, geography, asset_class (project-specific)
 *   - ICP fields (who would fund this)
 *
 * Perspective-grounded: the operator is the entity SEEKING capital. The ICP
 * is the CAPITAL PROVIDER (Investor for equity raises, Lender for debt
 * raises). Never the operator or downstream consumers.
 *
 * Funding-type aware (migration 027): the prompt's noun (INVESTOR vs
 * LENDER) AND the worked examples flip based on the project's
 * funding_type so an equity Seed round doesn't get a lender-styled
 * profile and vice versa. Reads funding_type from the DB if a project_id
 * is supplied.
 *
 * Returns the JSON profile; the client applies it to the projects row.
 */

import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { capitalProviderTerm, type FundingType } from '@/lib/types';

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InvestorPilot/1.0 (project-profile-extractor)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return `[Failed to fetch: ${res.status}]`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 8000);
  } catch {
    return '[Failed to fetch URL]';
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await request.json();
  const { project_id, source_url, source_text } = payload as {
    project_id?: string;
    source_url?: string;
    source_text?: string;
  };
  let name: string | undefined = payload?.name;
  let description: string | undefined = payload?.description;

  let sourceContent = '';
  let kbHasContent = false;
  let fundingType: FundingType | null = null;

  if (project_id) {
    const { data: existingSources } = await supabase
      .from('product_sources')
      .select('title, content')
      .eq('project_id', project_id)
      .eq('processing_status', 'completed');

    if (existingSources && existingSources.length > 0) {
      const kbContent = existingSources
        .filter((s: { content: string | null }) => s.content)
        .map((s: { title: string; content: string }) => `--- ${s.title} ---\n${s.content}`)
        .join('\n\n')
        .slice(0, 10000);
      if (kbContent.trim()) {
        sourceContent += `\n\nEXISTING KNOWLEDGE BASE:\n${kbContent}`;
        kbHasContent = true;
      }
    }

    // Pull the project's existing fields as authoritative anchors.
    // funding_type is the new lever (migration 027) — it flips the
    // INVESTOR/LENDER framing across the entire prompt so an equity
    // Seed round doesn't get a private-credit-styled ICP and vice versa.
    const { data: existingProject } = await supabase
      .from('projects')
      .select('name, description, funding_type')
      .eq('id', project_id)
      .single();
    if (!name) name = existingProject?.name;
    if (!description) description = existingProject?.description || undefined;
    fundingType = (existingProject?.funding_type as FundingType | null) || null;
  }

  if (!name && !source_url && !source_text && !kbHasContent) {
    return NextResponse.json(
      { error: 'Provide a name, URL, text, or upload sources first' },
      { status: 400 }
    );
  }

  if (source_url) {
    const pageText = await fetchPageContent(source_url);
    sourceContent += `\n\nWEBSITE CONTENT (from ${source_url}):\n${pageText}`;
  }

  if (source_text) {
    sourceContent += `\n\nPROVIDED COLLATERAL:\n${source_text.slice(0, 8000)}`;
  }

  // Funding-type-aware noun + examples. Equity raises get "INVESTOR"
  // framing with VC / family-office examples; debt raises get "LENDER"
  // framing with private credit / direct-lender examples. Default
  // (funding_type null) → INVESTOR, which is the safer fallback now
  // that InvestorPilot serves the full equity + debt spectrum.
  const { noun, nounUpper } = capitalProviderTerm(fundingType);
  const isDebt = nounUpper === 'LENDER';
  const partnerTypeValue = isDebt ? 'lender' : 'investor';

  // Worked examples branch by raise type so the model anchors on the
  // RIGHT kind of capital provider. Mixing the two (e.g. "Head of
  // Private Credit" example shown to an equity Seed round) was the
  // bias that produced lender-styled ICPs on equity projects.
  const examples = isDebt
    ? {
        partnerTypeLine: 'lender (senior_debt / mezzanine) — capital providers writing first-mortgage or mezz tickets',
        funding_target: '$16.2M @ 8.5% indicative + standard fees, ~22mo, first-mortgage',
        asset_class: 'Residential modular construction (37 dwellings)',
        core_mechanism: 'First-mortgage senior debt, pari-passu syndicate, fixed-term ~22mo',
        customer_outcomes: '8.5% indicative coupon, first-mortgage security, anchor offtake to Homes Tasmania',
        icp_company_size: 'AUM $50M-$500M private capital; cheque size $1-5M',
        icp_stage: 'Established direct lender with documented track record in AU property credit',
        icp_verticals: 'Private credit funds, family offices, HNW direct lending, real estate debt funds',
        icp_buyer_title: 'Head of Private Credit, Family Office CIO, Investment Director',
        icp_user_title: 'Credit Analyst, Investment Associate',
        icp_stack_tools: 'Credit analysis software, deal flow systems, IM diligence platforms',
        traction_arr: 'Anchor offtake signed, prior project completions, V10 Finance Submission ready',
        traction_customers: 'Existing senior lenders / equity participants if disclosed',
        exclusions: 'Retail banks, mortgage brokers, equity-only family offices, listed REITs, institutional debt funds >$1B AUM',
      }
    : {
        partnerTypeLine: 'investor (equity rounds — pre_seed / seed / series_a / etc) — VCs, family offices, angels writing equity cheques',
        funding_target: '$2-4M seed round at $15-20M post, 18-month runway',
        asset_class: 'B2B SaaS / EdTech / vertical AI infrastructure',
        core_mechanism: 'Priced seed round (preferred equity), pro-rata rights, single lead + co-investors',
        customer_outcomes: 'Exposure to vertical AI governance category pre-commoditization, recurring SaaS ARR with B2B + B2C revenue, founder with prior operating wins in SEA',
        icp_company_size: 'AUM $20M-$200M seed/Series A funds; cheque size $250K-$2M',
        icp_stage: 'Active seed / Series A investor with thesis in AI infrastructure / EdTech / SEA',
        icp_verticals: 'Seed VCs, family offices with SaaS thesis, angel syndicates, EdTech-focused funds, SEA-focused early-stage',
        icp_buyer_title: 'General Partner, Investment Principal, Family Office Investment Director',
        icp_user_title: 'Associate, Investment Manager, Analyst',
        icp_stack_tools: 'Carta, AngelList, Crunchbase, PitchBook, Affinity, Docsend',
        traction_arr: 'Operating since 2021, $X ARR, named enterprise contracts, certification partnerships',
        traction_customers: 'Existing angels / lead investors if disclosed',
        exclusions: 'Late-stage VCs (Series B+), pure consumer-only funds, generalist funds without AI/SaaS thesis, debt funds, revenue-based lenders',
      };

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Extract a PROJECT profile for InvestorPilot — a discovery tool that finds the ${nounUpper}S who would fund this project.

⚠ CRITICAL PERSPECTIVE — read this twice before generating:

The operator is the entity RAISING capital for this project. The "project" is an investable asset (${isDebt ? 'real-estate development, fund tranche, debt facility' : 'startup, SaaS platform, growth-stage company'}) seeking financing. The ICP fields describe THE CAPITAL PROVIDER — ${isDebt ? 'lender, family office private debt allocator, private credit fund' : 'venture capital fund, family office equity arm, angel investor syndicate, strategic investor'} — who would WRITE THE CHEQUE.

${isDebt ? 'Investment memoranda, finance submissions, term sheets describe the OFFERING from the borrower\'s perspective.' : 'Pitch decks, financial models, data rooms describe the OFFERING from the founder\'s / GP\'s perspective.'} DO NOT flip the framing — the operator is NOT providing finance, they are SEEKING it. The ICP is NOT the operator's customers, contractors, or end-users — it is THE ${nounUpper}.

The description should describe THIS PROJECT (what's being funded, by whom, at what terms${isDebt ? ', with what security' : ', at what stage'}) — framed as a pitch TO the ${noun.toLowerCase()}. NOT a description of the operational mechanism of ${isDebt ? 'construction or development' : 'the product or technology'}.

Always silently answer: "Who provides the capital this project is asking for?" — that answer is the ICP. The ${isDebt ? 'sponsor, borrower, developer, contractors' : 'founder, customers, end-users, partners, contractors'} are NEVER the ICP.

⚠ GEOGRAPHY RULE FOR EXCLUSIONS — DO NOT OVER-RESTRICT BY ${nounUpper} LOCATION:
${isDebt
  ? 'Sydney, Melbourne, and Singapore family offices and private credit funds routinely fund regional Australian property — that is in fact the dominant pattern. NEVER write exclusions like "interstate lenders unfamiliar with [region]" or "non-WA private credit", because that excludes 80%+ of the actual ICP.'
  : 'Singapore, Hong Kong, US, UK, and AU funds routinely co-invest in SEA / Vietnamese startups — many of the most active investors are NOT based locally. NEVER write exclusions like "non-Vietnamese funds" or "investors outside SEA". The strongest seed leads for a Vietnamese B2B SaaS are often US-based with SEA thesis.'}
Geography belongs in the project profile (where the asset / company sits), not in ${noun.toLowerCase()} exclusions. ${noun} exclusions should be about TYPE and STAGE, not LOCATION.

${name ? `CURRENT PROJECT NAME (may be stale — update if KB describes a different project): ${name}` : 'Extract the project name from the content below.'}
${description ? `CURRENT DESCRIPTION (may be stale — rewrite if KB describes a different project): ${description}` : ''}
${fundingType ? `FUNDING TYPE (already set by operator — anchor all ICP fields against this): ${fundingType}` : ''}

⚠ KB IS CANONICAL — IDENTITY-OVERRIDE RULE:
If the current name and description suggest one project but the Knowledge Base content predominantly describes a different one, TREAT THE KB AS THE SOURCE OF TRUTH and rewrite the name + description to match what the KB actually says. The operator may have swapped docs to repurpose the project record.

When the KB clearly aligns with the current name (same project, same asset / company, same geography), preserve the operator's wording where it's substantive and refine where it's thin.
${sourceContent}

Based on ALL the information above (with perspective grounded as instructed), generate accurate values. Use specific details from the source material — names of projects, sponsors, co-investors, specific rates / sizes / cheque bands / geographies. Don't generalize. Be concise — 1-2 sentences max per field.

Return ONLY valid JSON with these exact keys:
{
  "name": "Project name (extract from content if not provided)",
  "sponsor": "The entity raising the capital",
  "description": "What's being funded, pitched to the ${nounUpper} in one sentence. Names specific assets / companies, geographies, sizes.",
  "funding_target": "Concrete ask, e.g. '${examples.funding_target}'",
  "geography": "Where the ${isDebt ? 'asset sits' : 'company operates'}, e.g. 'Claremont, Tasmania'",
  "asset_class": "What kind of ${isDebt ? 'asset' : 'company / market'}, e.g. '${examples.asset_class}'",
  "core_mechanism": "The investment structure from the ${nounUpper}'s perspective — e.g. '${examples.core_mechanism}'",
  "customer_outcomes": "3 specific outcomes the ${nounUpper} gets, comma-separated (e.g. '${examples.customer_outcomes}')",
  "icp_company_size": "Size of the ${nounUpper} firm (e.g. '${examples.icp_company_size}')",
  "icp_stage": "Stage of the ${nounUpper} firm (e.g. '${examples.icp_stage}')",
  "icp_verticals": "3-6 verticals the ${nounUpper} operates in (e.g. '${examples.icp_verticals}')",
  "icp_buyer_title": "Primary ${nounUpper} title (e.g. '${examples.icp_buyer_title}')",
  "icp_user_title": "Primary user title at the ${nounUpper} firm (e.g. '${examples.icp_user_title}')",
  "icp_stack_tools": "3-5 tools relevant in the ${nounUpper}'s stack (e.g. '${examples.icp_stack_tools}')",
  "traction_arr": "Concrete proof points — e.g. '${examples.traction_arr}'",
  "traction_customers": "${examples.traction_customers}",
  "partner_types": "${partnerTypeValue}  — matching the funding_type (${examples.partnerTypeLine})",
  "exclusions": "${nounUpper} types to exclude (e.g. '${examples.exclusions}')"
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return NextResponse.json({ error: 'Failed to generate project profile' }, { status: 500 });
  }

  try {
    const profile = JSON.parse(jsonMatch[0]);
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ error: 'Profile JSON parse failed' }, { status: 500 });
  }
}
