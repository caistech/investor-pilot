/**
 * GET    /api/org/unipile  — read the active org's BYOK Unipile config (key is masked)
 * POST   /api/org/unipile  — owner-only: set the org's Unipile API key.
 *                            Round-trips a listAccounts() call against the new
 *                            key to validate it before saving.
 * DELETE /api/org/unipile  — owner-only: clear the org's key (falls back to platform shared tenant)
 */

import { NextResponse } from 'next/server';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { createUnipileClient } from '@caistech/unipile-channels';

export const dynamic = 'force-dynamic';

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length < 12) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function GET() {
  const { db, orgId, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 400 });

  const { data: org } = await db!
    .from('organisations')
    .select('unipile_api_key, unipile_tenant_id')
    .eq('id', orgId)
    .maybeSingle();

  return NextResponse.json({
    has_key: !!org?.unipile_api_key,
    masked_key: maskKey(org?.unipile_api_key ?? null),
    tenant_id: org?.unipile_tenant_id ?? null,
    platform_fallback_available: !!process.env.UNIPILE_API_KEY,
  });
}

export async function POST(request: Request) {
  const { user, db, orgId, role, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 400 });
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Only org owners can change Unipile credentials' }, { status: 403 });
  }

  const { api_key, base_url } = (await request.json()) as { api_key?: string; base_url?: string };
  if (!api_key || typeof api_key !== 'string' || api_key.length < 20) {
    return NextResponse.json({ error: 'Provide a valid Unipile API key' }, { status: 400 });
  }
  if (!base_url || typeof base_url !== 'string' || !base_url.startsWith('https://')) {
    return NextResponse.json({ error: 'Provide a valid Unipile base URL (https://apiX.unipile.com:13XXX from your Unipile dashboard)' }, { status: 400 });
  }

  // Round-trip the key against Unipile before persisting. If it can't list
  // accounts, the operator pasted a bad key or wrong DSN — surface that
  // before we save and they're confused why nothing works.
  try {
    const testClient = createUnipileClient({ apiKey: api_key, baseUrl: base_url });
    const result = await testClient.listAccounts();
    if (!result.ok) {
      return NextResponse.json({
        error: `Could not validate key against Unipile: ${'error' in result ? result.error : 'unknown'}`,
      }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({
      error: `Validation failed: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 400 });
  }

  const { error: updateError } = await db!
    .from('organisations')
    .update({
      unipile_api_key: api_key,
      // base_url is platform-wide for now; if BYOK orgs need their own DSN
      // we add organisations.unipile_base_url column. Today: assume they
      // share the platform's DSN URL pattern.
    })
    .eq('id', orgId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await db!.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.unipile_byok_set',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: { masked_key: maskKey(api_key) },
  });

  return NextResponse.json({ ok: true, masked_key: maskKey(api_key) });
}

export async function DELETE() {
  const { user, db, orgId, role, error } = await authenticateAndGetDb();
  if (error) return error;
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 400 });
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Only org owners can clear Unipile credentials' }, { status: 403 });
  }

  await db!
    .from('organisations')
    .update({ unipile_api_key: null, unipile_tenant_id: null })
    .eq('id', orgId);

  await db!.from('audit_events').insert({
    organisation_id: orgId,
    actor: `user:${user!.id}`,
    action: 'team.unipile_byok_cleared',
    resource_type: 'organisation',
    resource_id: orgId,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
