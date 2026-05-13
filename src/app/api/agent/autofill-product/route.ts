import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InvestorPilot/1.0 (product-profile-extractor)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return `[Failed to fetch: ${res.status}]`;

    const html = await res.text();
    // Strip HTML tags, scripts, styles — extract text content
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Cap at ~8000 chars to keep within token limits
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
  const { description, source_url, source_text, product_id } = payload as {
    description?: string;
    source_url?: string;
    source_text?: string;
    product_id?: string;
  };
  let name: string | undefined = payload?.name;

  // Build context from available sources
  let sourceContent = '';
  let kbHasContent = false;

  // Include existing knowledge base if product_id provided. Also pull the
  // product's existing name as the implicit seed so a "re-generate from KB"
  // call from the SourceManager button works without resending name.
  if (product_id) {
    const { data: existingSources } = await supabase
      .from('product_sources')
      .select('title, content')
      .eq('product_id', product_id)
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

    if (!name) {
      const { data: existingProduct } = await supabase
        .from('products')
        .select('name')
        .eq('id', product_id)
        .single();
      name = existingProduct?.name;
    }
  }

  if (!name && !source_url && !source_text && !kbHasContent) {
    return NextResponse.json(
      { error: 'Provide a product name, URL, text, or upload sources to the Knowledge Base first' },
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
      content: `Extract a product profile for InvestorPilot — a discovery tool that finds the BUYERS / INVESTORS / LENDERS / PARTNERS for the operator's offering.

⚠ CRITICAL PERSPECTIVE — read this twice before generating:

The operator using InvestorPilot is the entity OFFERING this product. The ICP fields describe the people/firms who would BUY, FUND, or PARTNER with that offering — NOT the operator themselves and NOT downstream consumers of what the operator builds.

For financial pitch documents (investment memoranda, term sheets, debt placement memos, fund offerings) this is especially important:
  - The "product" is the INVESTMENT OPPORTUNITY being placed
  - The ICP is the CAPITAL PROVIDER — lender, family office private debt allocator, HNW direct lender, private credit fund — who would FUND that opportunity
  - DO NOT describe the borrower's project, the developer co-partners, or the construction supply chain
  - DO NOT describe the entity producing the asset — describe who would write the cheque

For SaaS / service offerings:
  - Product is the SaaS/service itself
  - ICP is the customer who would buy it
  - Buyer title is the BUYER's role at their company, never the seller's executives

Always silently answer: "Who pays for / invests in / partners on this product?" — that answer is the ICP. The operator providing the product is NEVER the ICP.

${name ? `PRODUCT NAME: ${name}` : 'Extract the product name from the content below.'}
${description ? `OPERATOR-PROVIDED DESCRIPTION (authoritative — do NOT contradict): ${description}` : ''}
${sourceContent}

Based on ALL the information above (with perspective grounded as instructed), generate accurate values for each field. Use specific details from the source material — don't generalize. If the source mentions pricing, customer types, industries, or tech stack, use those exact details.

Be concise — each field should be 1-2 sentences max.

Return ONLY valid JSON with these exact keys:
{
  "name": "Product name (extract from content if not provided)",
  "one_sentence_description": "What the OPERATOR is offering, framed for the BUYER/LENDER/INVESTOR audience in one sentence",
  "core_mechanism": "How the product works from the perspective of the buyer/investor — the key value lever",
  "customer_outcomes": "3 specific outcomes the BUYER/INVESTOR/LENDER gets, comma-separated",
  "icp_company_size": "Size of the BUYER/INVESTOR firm (e.g. AUM band for funds, employee count for SaaS)",
  "icp_stage": "Stage of the BUYER/INVESTOR firm (e.g. 'Established direct lender' or 'Revenue-generating startup')",
  "icp_verticals": "3-6 verticals the BUYER/INVESTOR operates in",
  "icp_buyer_title": "Primary BUYER title at the investor/customer firm (e.g. 'Head of Private Credit', not 'Development Manager')",
  "icp_user_title": "Primary user title at the BUYER firm",
  "icp_stack_tools": "3-5 tools most relevant in the BUYER's current stack",
  "traction_arr": "Pricing tiers or ARR if mentioned, otherwise best guess",
  "traction_customers": "Customer count or stage if mentioned",
  "partner_types": "referral, integration, or reseller — pick most relevant",
  "exclusions": "Types of companies to exclude from partnership search"
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return NextResponse.json({ error: 'Failed to generate profile' }, { status: 500 });
  }

  const profile = JSON.parse(jsonMatch[0]);
  return NextResponse.json(profile);
}
