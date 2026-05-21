import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

  const { data: partners, error } = await supabase
    .from('partners')
    .select('*')
    .eq('organisation_id', profile.active_organisation_id)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(partners);
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 });

  const body = await request.json();

  // Upsert by domain
  if (body.domain) {
    const { data: existing } = await supabase
      .from('partners')
      .select('id')
      .eq('organisation_id', profile.active_organisation_id)
      .eq('domain', body.domain)
      .single();

    if (existing) {
      const { data, error } = await supabase
        .from('partners')
        .update({ ...body, last_updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
  }

  const { data, error } = await supabase
    .from('partners')
    .insert({ ...body, organisation_id: profile.active_organisation_id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
