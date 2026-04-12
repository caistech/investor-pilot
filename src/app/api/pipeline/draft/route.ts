import Anthropic from '@anthropic-ai/sdk';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { saveDraft } from '@/lib/db/partners';
import { getProductWebsiteUrl } from '@/lib/agent/sources';
import { NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY!,
  ...(process.env.OPENROUTER_API_KEY ? {
    baseURL: 'https://openrouter.ai/api',
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://investorpilot.vercel.app',
      'X-Title': 'InvestorPilot',
    },
  } : {}),
});

const MODEL = process.env.OPENROUTER_API_KEY
  ? (process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4-20250514')
  : (process.env.AGENT_MODEL || 'claude-sonnet-4-20250514');

const DRAFT_PROMPT = `You are an outreach email writer for investor sourcing. Write a personalized cold outreach email to a financial advisor or wealth manager about an investment opportunity.

Return ONLY a JSON object (no markdown, no explanation):
{
  "subject": "<specific, benefit-oriented subject line — framed as investment opportunity brief>",
  "body": "<email body, under 150 words>",
  "partnership_motion": "<investment briefing | referral arrangement | distribution partnership | introductory call>",
  "selected_gtm_angle": "<one sentence describing the angle>"
}

EMAIL RULES:
- Subject: specific and benefit-oriented, framed as investment opportunity
- Opening: one sentence grounded in what their clients need
- Body: lead with the investment thesis and why it's relevant to THEIR clients
- MANDATORY: The email body MUST contain the product website URL (provided in the product context) as a clickable link. Place it naturally where you mention the product. Every draft without this link will be rejected.
- Ask: one low-commitment next step
- Length: under 150 words
- Tone: professional, founder to senior financial advisor
- Signature: Dennis | Corporate AI Solutions | corporateaisolutions.com
- After the signature, ALWAYS add: PS: See our other products here: https://corporate-ai-solutions.vercel.app/marketplace
- NEVER use: "I hope this finds you well", "synergy", "mutual benefit", "exciting opportunity"
- NEVER fabricate specific claims about their company or AUM`;

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { partner_ids, organisation_id, product_id } = await request.json() as {
    partner_ids: string[];
    organisation_id: string;
    product_id: string;
  };

  if (!partner_ids?.length || !organisation_id || !product_id) {
    return NextResponse.json({ error: 'partner_ids[], organisation_id, and product_id required' }, { status: 400 });
  }

  // Load product and its website URL
  const [{ data: product }, productUrl] = await Promise.all([
    db.from('products')
      .select('name, one_sentence_description, core_mechanism, customer_outcomes')
      .eq('id', product_id)
      .single(),
    getProductWebsiteUrl(product_id),
  ]);

  const productContext = product
    ? `Product: ${product.name}. ${product.one_sentence_description || ''}. Core: ${product.core_mechanism || ''}. Outcomes: ${product.customer_outcomes || ''}.${productUrl ? ` Product website: ${productUrl}` : ''}`
    : '';

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

  // Sequential to respect rate limits
  for (const partner of partners) {
    if (!partner.contact_email) {
      results.push({
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'skipped',
        error: 'No contact email',
      });
      continue;
    }

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: DRAFT_PROMPT,
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
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        results.push({ partner_id: partner.id, company_name: partner.company_name, status: 'error', error: 'Invalid draft response' });
        continue;
      }

      const draft = JSON.parse(jsonMatch[0]);

      await saveDraft(db, organisation_id, partner.domain, {
        draft_subject: draft.subject,
        draft_body: draft.body,
        partnership_motion: draft.partnership_motion,
        selected_gtm_angle: draft.selected_gtm_angle,
      });

      results.push({
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'drafted',
        subject: draft.subject,
      });
    } catch (err) {
      await db.from('partners').update({
        draft_status: 'none',
        last_updated_at: new Date().toISOString(),
      }).eq('id', partner.id);

      results.push({
        partner_id: partner.id,
        company_name: partner.company_name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    drafted: results.filter(r => r.status === 'drafted').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  });
}
