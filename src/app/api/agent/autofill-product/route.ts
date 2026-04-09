import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, description } = await request.json();

  if (!name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Given this product, generate a complete ICP (Ideal Customer Profile) and product profile for use in a partnership discovery tool.

PRODUCT NAME: ${name}
DESCRIPTION: ${description || 'Not provided — infer from the name.'}

Generate realistic, specific values for each field. Be concise — each field should be 1-2 sentences max, not paragraphs.

Return ONLY valid JSON with these exact keys:
{
  "one_sentence_description": "...",
  "core_mechanism": "How the product works in one sentence",
  "customer_outcomes": "3 specific outcomes after 90 days of use, comma-separated",
  "icp_company_size": "e.g. 5-200 employees",
  "icp_stage": "e.g. Revenue-generating, profitable or well-funded startup",
  "icp_verticals": "Comma-separated list of 3-6 verticals",
  "icp_buyer_title": "Primary buyer title(s)",
  "icp_user_title": "Primary user title(s)",
  "icp_stack_tools": "3-5 tools most relevant in their current stack",
  "traction_arr": "Pricing tiers or ARR range",
  "traction_customers": "Customer count or stage description",
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
