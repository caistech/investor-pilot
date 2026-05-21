// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
import { createClient } from '@/lib/supabase/server';
import ChannelsClient from './channels-client';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id')
    .single();

  let channels: Array<{
    id: string;
    channel_type: string;
    provider: string;
    account_identifier: string;
    display_name: string | null;
    status: string;
    pause_reason: string | null;
    daily_send_cap: number;
    daily_send_count: number;
    warmup_day: number;
    last_health_check_at: string | null;
    created_at: string;
  }> = [];

  if (profile?.active_organisation_id) {
    const { data } = await supabase
      .from('client_channels')
      .select('id, channel_type, provider, account_identifier, display_name, status, pause_reason, daily_send_cap, daily_send_count, warmup_day, last_health_check_at, created_at')
      .eq('organisation_id', profile.active_organisation_id)
      .order('created_at', { ascending: false });
    channels = data || [];
  }

  return <ChannelsClient channels={channels} />;
}
