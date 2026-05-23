import { NextRequest, NextResponse } from 'next/server';
import { authenticateMethodologyApiKey } from '@/lib/methodology/auth';

/**
 * GET /api/methodology/campaigns/[id]/responses
 *
 * Returns responses received for a campaign. In Session 1 this is an empty
 * placeholder — Session 2 wires real response capture (when the campaign is
 * promoted to an IP project and starts sending, replies flow through the
 * existing outreach_log + outbound_messages tables; this endpoint then joins
 * those by campaign_id).
 *
 * The shape is set now so the CAS sync logic can be built against it.
 *
 * Auth: METHODOLOGY_API_KEY Bearer token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = authenticateMethodologyApiKey(request);
  if (!auth.ok) return auth.error;

  type CampaignRow = { id: string; status: string; ip_project_id: string | null } | null;
  const db = auth.db as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: CampaignRow; error: { message: string } | null }>;
        };
      };
    };
  };

  const { data: campaign, error: campaignError } = await db
    .from('methodology_campaigns')
    .select('id, status, ip_project_id')
    .eq('id', params.id)
    .maybeSingle();

  if (campaignError) {
    console.error('methodology_campaigns lookup failed:', campaignError);
    return NextResponse.json({ error: 'Failed to read campaign' }, { status: 500 });
  }

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Session 1 placeholder — no responses yet. Session 2 will return real data
  // once campaigns are promoted to projects and outreach_log is wired in.
  return NextResponse.json({
    campaign_id: params.id,
    campaign_status: campaign.status,
    ip_project_id: campaign.ip_project_id,
    responses: [],
    note:
      campaign.ip_project_id === null
        ? 'Campaign is configured but not yet promoted to an IP project (Session 2 work). No responses available.'
        : 'Response sync not yet implemented (Session 2).',
  });
}
