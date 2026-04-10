import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PartnerPilot/1.0 (product-profile-extractor)' },
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

  const { name, description, source_url, source_text, product_id } = await request.json();

  if (!name && !source_url && !source_text) {
    return NextResponse.json({ error: 'Provide a product name, URL, or text' }, { status: 400 });
  }

  // Build context from available sources
  let sourceContent = '';

  // Include existing knowledge base if product_id provided
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
      sourceContent += `\n\nEXISTING KNOWLEDGE BASE:\n${kbContent}`;
    }
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
      content: `Extract a complete product profile from the information provided. This is for a partnership discovery tool that finds channel partners.

${name ? `PRODUCT NAME: ${name}` : 'Extract the product name from the content below.'}
${description ? `DESCRIPTION: ${description}` : ''}
${sourceContent}

Based on ALL the information above, generate accurate values for each field. Use specific details from the source material — don't generalize. If the source mentions pricing, customer types, industries, or tech stack, use those exact details.

Be concise — each field should be 1-2 sentences max.

Return ONLY valid JSON with these exact keys:
{
  "name": "Product name (extract from content if not provided)",
  "one_sentence_description": "What it does in one sentence",
  "core_mechanism": "How the product works — the key technical approach",
  "customer_outcomes": "3 specific outcomes after 90 days, comma-separated",
  "icp_company_size": "e.g. 5-200 employees",
  "icp_stage": "e.g. Revenue-generating, profitable or well-funded startup",
  "icp_verticals": "Comma-separated list of 3-6 verticals",
  "icp_buyer_title": "Primary buyer title(s)",
  "icp_user_title": "Primary user title(s)",
  "icp_stack_tools": "3-5 tools most relevant in their current stack",
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
