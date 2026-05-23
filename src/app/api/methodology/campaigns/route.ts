import { NextRequest, NextResponse } from 'next/server';
import { authenticateMethodologyApiKey } from '@/lib/methodology/auth';

/**
 * POST /api/methodology/campaigns
 *
 * Called by CAS (Corporate-AI-Solutions) to register a methodology validation
 * campaign on InvestorPilot. CAS owns the lifecycle; IP holds the campaign
 * config and (in Session 2) the actual outreach state.
 *
 * Auth: METHODOLOGY_API_KEY Bearer token.
 *
 * Body shape:
 *   {
 *     cas_product_slug: 'rehearsals-ai',
 *     cas_card_id?: 'uuid',
 *     campaign_type: 'target-user' | 'distributor-candidate',
 *     icp_description: '...',
 *     questions: ['...', '...'],
 *     expected_response_count?: 30,
 *     channel_mix?: ['linkedin', 'email']
 *   }
 *
 * Returns: { campaign: { id, status: 'configured', ... } }
 */

interface CampaignCreateInput {
  cas_product_slug?: unknown;
  cas_card_id?: unknown;
  campaign_type?: unknown;
  icp_description?: unknown;
  questions?: unknown;
  expected_response_count?: unknown;
  channel_mix?: unknown;
}

interface CampaignValidated {
  cas_product_slug: string;
  cas_card_id: string | null;
  campaign_type: 'target-user' | 'distributor-candidate';
  icp_description: string;
  questions: string[];
  expected_response_count: number;
  channel_mix: ('linkedin' | 'email')[];
}

function validateCampaignInput(body: CampaignCreateInput):
  | { ok: true; data: CampaignValidated }
  | { ok: false; reason: string } {
  if (typeof body.cas_product_slug !== 'string' || body.cas_product_slug.trim().length === 0) {
    return { ok: false, reason: 'cas_product_slug is required (non-empty string)' };
  }
  if (body.cas_product_slug.length > 120) {
    return { ok: false, reason: 'cas_product_slug too long (max 120 chars)' };
  }

  if (body.cas_card_id !== undefined && body.cas_card_id !== null) {
    if (typeof body.cas_card_id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(body.cas_card_id)) {
      return { ok: false, reason: 'cas_card_id must be a valid UUID' };
    }
  }

  if (body.campaign_type !== 'target-user' && body.campaign_type !== 'distributor-candidate') {
    return { ok: false, reason: "campaign_type must be 'target-user' or 'distributor-candidate'" };
  }

  if (typeof body.icp_description !== 'string' || body.icp_description.trim().length < 10) {
    return { ok: false, reason: 'icp_description is required (min 10 chars)' };
  }
  if (body.icp_description.length > 2000) {
    return { ok: false, reason: 'icp_description too long (max 2000 chars)' };
  }

  if (!Array.isArray(body.questions) || body.questions.length === 0 || body.questions.length > 20) {
    return { ok: false, reason: 'questions must be a non-empty array (max 20)' };
  }
  for (const q of body.questions) {
    if (typeof q !== 'string' || q.trim().length === 0 || q.length > 1000) {
      return { ok: false, reason: 'each question must be a non-empty string (max 1000 chars)' };
    }
  }

  let expected_response_count = 30;
  if (body.expected_response_count !== undefined) {
    if (typeof body.expected_response_count !== 'number' ||
        !Number.isInteger(body.expected_response_count) ||
        body.expected_response_count <= 0 ||
        body.expected_response_count > 500) {
      return { ok: false, reason: 'expected_response_count must be a positive integer ≤ 500' };
    }
    expected_response_count = body.expected_response_count;
  }

  let channel_mix: ('linkedin' | 'email')[] = ['linkedin', 'email'];
  if (body.channel_mix !== undefined) {
    if (!Array.isArray(body.channel_mix) || body.channel_mix.length === 0) {
      return { ok: false, reason: 'channel_mix must be a non-empty array' };
    }
    for (const ch of body.channel_mix) {
      if (ch !== 'linkedin' && ch !== 'email') {
        return { ok: false, reason: "channel_mix entries must be 'linkedin' or 'email'" };
      }
    }
    channel_mix = body.channel_mix as ('linkedin' | 'email')[];
  }

  return {
    ok: true,
    data: {
      cas_product_slug: body.cas_product_slug.trim(),
      cas_card_id: (body.cas_card_id as string | undefined) ?? null,
      campaign_type: body.campaign_type,
      icp_description: body.icp_description.trim(),
      questions: body.questions as string[],
      expected_response_count,
      channel_mix,
    },
  };
}

export async function POST(request: NextRequest) {
  const auth = authenticateMethodologyApiKey(request);
  if (!auth.ok) return auth.error;

  let body: CampaignCreateInput;
  try {
    body = (await request.json()) as CampaignCreateInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validated = validateCampaignInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  // Cast: methodology_campaigns is added via migration 048; the generated
  // DB types may not yet include it. Service client is untyped at runtime.
  const db = auth.db as unknown as {
    from: (t: string) => {
      insert: (v: unknown) => {
        select: () => { single: () => Promise<{ data: unknown; error: { message: string } | null }> };
      };
    };
  };

  const { data, error } = await db
    .from('methodology_campaigns')
    .insert({
      cas_product_slug: validated.data.cas_product_slug,
      cas_card_id: validated.data.cas_card_id,
      campaign_type: validated.data.campaign_type,
      icp_description: validated.data.icp_description,
      questions: validated.data.questions,
      expected_response_count: validated.data.expected_response_count,
      channel_mix: validated.data.channel_mix,
      status: 'configured',
    })
    .select()
    .single();

  if (error) {
    console.error('methodology_campaigns insert failed:', error);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }

  return NextResponse.json({ campaign: data }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const auth = authenticateMethodologyApiKey(request);
  if (!auth.ok) return auth.error;

  const url = new URL(request.url);
  const productSlug = url.searchParams.get('product_slug');

  const db = auth.db as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }> & {
          eq: (col: string, val: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };

  let query = db
    .from('methodology_campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (productSlug) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).eq('cas_product_slug', productSlug);
  }

  const { data, error } = await query;

  if (error) {
    console.error('methodology_campaigns select failed:', error);
    return NextResponse.json({ error: 'Failed to read campaigns' }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data ?? [] });
}
