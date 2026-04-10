import { authenticateAndGetDb } from '@/lib/agent/db';
import { NextResponse } from 'next/server';
import type { Partner } from '@/lib/types';

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { product_id } = await request.json();

  const { data: profile } = await db
    .from('profiles')
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  const { data } = await db
    .from('partners')
    .select('id, company_name, domain, status, contact_email, email_confidence')
    .eq('organisation_id', profile?.organisation_id)
    .eq('product_id', product_id)
    .in('status', ['angle_defined', 'contact_found', 'contact_partial', 'scored'])
    .not('contact_email', 'is', null)
    .order('weighted_score', { ascending: false })
    .limit(10);

  const eligible = (data || []) as Array<Pick<Partner, 'id' | 'company_name' | 'domain' | 'status' | 'contact_email' | 'email_confidence'>>;

  return NextResponse.json({
    success: true,
    data: { eligible_partners: eligible, count: eligible.length },
  });
}
