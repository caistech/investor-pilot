import { NextRequest, NextResponse } from 'next/server';
import { authenticateMethodologyApiKey } from '@/lib/methodology/auth';

/**
 * GET /api/methodology/campaigns/[id]
 *
 * Returns a single campaign by ID.
 *
 * Auth: METHODOLOGY_API_KEY Bearer token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = authenticateMethodologyApiKey(request);
  if (!auth.ok) return auth.error;

  // methodology_campaigns is added via migration 048; cast through unknown
  // because generated DB types may lag the migration.
  const db = auth.db as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };

  const { data, error } = await db
    .from('methodology_campaigns')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    console.error('methodology_campaigns select failed:', error);
    return NextResponse.json({ error: 'Failed to read campaign' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({ campaign: data });
}
