/**
 * POST /api/agent/autofill-project
 *
 * Project-aware autofill. Reads the project's Knowledge Base + optional
 * URL/text seed and asks Claude to extract:
 *   - description (the elevator pitch FOR the lender)
 *   - project_type, funding_target, geography, asset_class (project-specific)
 *   - ICP fields (who would fund this)
 *
 * Perspective-grounded: the operator is the entity SEEKING capital. The ICP
 * is the BUYER/INVESTOR/LENDER. Never the operator or downstream consumers.
 *
 * Returns the JSON profile; the client applies it to the projects row.
 */

import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

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
    if (!name || !description) {
      const { data: existingProject } = await supabase
        .from('projects')
        .select('name, description')
        .eq('id', project_id)
        .single();
      if (!name) name = existingProject?.name;
      if (!description) description = existingProject?.description || undefined;
    }
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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Extract a PROJECT profile for InvestorPilot — a discovery tool that finds the LENDERS / INVESTORS who would fund this project.

⚠ CRITICAL PERSPECTIVE — read this twice before generating:

The operator is the entity RAISING capital for this project. The "project" is an investable asset (real-estate development, fund tranche, business expansion) seeking financing. The ICP fields describe THE CAPITAL PROVIDER — lender, family office private debt allocator, HNW direct lender, private credit fund, equity LP — who would WRITE THE CHEQUE.

Investment memoranda, finance submissions, term sheets describe the OFFERING from the borrower's perspective. DO NOT flip the framing — the operator is NOT providing finance, they are SEEKING it. The ICP is NOT the borrower's customers, contractors, or co-developers — it is THE FUNDER.

The description should describe THIS PROJECT (what's being funded, by whom, at what terms, with what security) — framed as a pitch TO the funder. NOT a description of the operational mechanism of construction or development.

Always silently answer: "Who provides the capital this project is asking for?" — that answer is the ICP. The sponsor, the borrower, the developer, the contractors are NEVER the ICP.

⚠ GEOGRAPHY RULE FOR EXCLUSIONS — DO NOT OVER-RESTRICT BY LENDER LOCATION:
Sydney, Melbourne, and Singapore family offices and private credit funds routinely fund regional Australian property — that is in fact the dominant pattern. NEVER write exclusions like "interstate lenders unfamiliar with [region]" or "non-WA private credit", because that excludes 80%+ of the actual ICP. Geography belongs in the project profile (where the asset sits), not in lender exclusions. Lender exclusions should be about TYPE (retail banks, mortgage brokers, equity-only funds) and SIZE (institutional debt funds >$1B AUM), not LOCATION.

${name ? `CURRENT PROJECT NAME (may be stale — update if KB describes a different project): ${name}` : 'Extract the project name from the content below.'}
${description ? `CURRENT DESCRIPTION (may be stale — rewrite if KB describes a different project): ${description}` : ''}

⚠ KB IS CANONICAL — IDENTITY-OVERRIDE RULE:
If the current name and description suggest one project (e.g. "Seafields Estate") but the Knowledge Base content predominantly describes a different one (e.g. all the docs talk about Branscombe Estate in Tasmania, with no Seafields content), TREAT THE KB AS THE SOURCE OF TRUTH and rewrite the name + description to match what the KB actually says. The operator may have swapped docs to repurpose the project record.

Signals that the current name/description is stale and should be replaced:
- Specific project / asset names in the KB don't match the current name
- Geography in the KB contradicts the current description
- Funding size / structure in the KB contradicts the current description

When the KB clearly aligns with the current name (same project, same asset, same geography), preserve the operator's wording where it's substantive and refine where it's thin.
${sourceContent}

Based on ALL the information above (with perspective grounded as instructed), generate accurate values. Use specific details from the source material — names of projects, sponsors, co-developers, specific rates, specific cheque sizes, specific geographies. Don't generalize. Be concise — 1-2 sentences max per field.

Return ONLY valid JSON with these exact keys:
{
  "name": "Project name (extract from content if not provided)",
  "sponsor": "The entity raising the capital, e.g. 'F2K Capital'",
  "description": "What's being funded, pitched to the FUNDER in one sentence. Names specific assets, geographies, sizes.",
  "project_type": "senior_debt | mezzanine | equity | platform_equity | mixed",
  "funding_target": "Concrete ask, e.g. '$16.2M @ 8.5% indicative + standard fees, ~22mo, first-mortgage'",
  "geography": "Where the asset sits, e.g. 'Claremont, Tasmania'",
  "asset_class": "What kind of asset, e.g. 'Residential modular construction (37 dwellings)'",
  "core_mechanism": "The investment structure from the LENDER's perspective — first-mortgage, pari-passu, syndicated, etc.",
  "customer_outcomes": "3 specific outcomes the LENDER/INVESTOR gets, comma-separated (e.g. '8.5% indicative coupon, first-mortgage security, anchor offtake to Homes Tasmania')",
  "icp_company_size": "Size of the FUNDER firm (e.g. 'AUM $50M-$500M private capital; cheque size $1-5M')",
  "icp_stage": "Stage of the FUNDER firm (e.g. 'Established direct lender with documented track record')",
  "icp_verticals": "3-6 verticals the FUNDER operates in (e.g. 'Private credit funds, family offices, HNW direct lending')",
  "icp_buyer_title": "Primary BUYER/FUNDER title (e.g. 'Head of Private Credit, Family Office CIO, Investment Director')",
  "icp_user_title": "Primary user title at the FUNDER firm",
  "icp_stack_tools": "3-5 tools relevant in the FUNDER's stack (credit analysis software, deal flow systems, etc.)",
  "traction_arr": "Concrete proof points — fees, anchor offtake, signed agreements, prior project completions",
  "traction_customers": "Existing lender / equity participants if any disclosed in source",
  "partner_types": "lender (for senior_debt/mezzanine) | investor (for equity/platform_equity)",
  "exclusions": "Lender/investor types to exclude (e.g. 'retail banks, mortgage brokers, equity-only FOs, listed REITs, institutional debt funds >$1B AUM')"
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
