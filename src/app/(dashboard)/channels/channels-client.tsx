'use client';

import { useState } from 'react';
import { Send, Mail, Calendar, AlertTriangle, CheckCircle2, Pause, Play, ShieldAlert, Plus, RefreshCw } from 'lucide-react';

interface Channel {
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
}

interface Props {
  channels: Channel[];
}

export default function ChannelsClient({ channels }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connectChannel(provider: 'linkedin' | 'gmail' | 'outlook') {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch('/api/auth/unipile/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to start OAuth');
        return;
      }
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  async function pauseChannel(channelId: string, reason: string) {
    if (!confirm('Pause this channel? No further sends will go out until resumed.')) return;
    setBusy(channelId);
    try {
      const res = await fetch(`/api/channels/${channelId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed to pause');
        return;
      }
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function resumeChannel(channelId: string) {
    setBusy(channelId);
    try {
      const res = await fetch(`/api/channels/${channelId}/resume`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed to resume');
        return;
      }
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function syncFromUnipile() {
    setBusy('sync');
    setError(null);
    try {
      const res = await fetch('/api/channels/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Sync failed');
        return;
      }
      const msg = `Synced ${json.synced_count} account(s)${json.skipped_count ? `, skipped ${json.skipped_count}` : ''}.`;
      alert(msg);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  async function globalKillSwitch() {
    const reason = prompt('Why are you pausing all channels? (Logged to audit trail)');
    if (!reason) return;
    if (!confirm(`Pause ALL ${channels.filter(c => c.status === 'active').length} active channels? This stops every outbound send immediately.`)) return;
    setBusy('kill-switch');
    try {
      const res = await fetch('/api/channels/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Kill switch failed');
        return;
      }
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  const activeCount = channels.filter(c => c.status === 'active').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1>Channels</h1>
          <p className="text-dark-400 mt-1">Connect LinkedIn and email accounts to send outreach from your own identity.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncFromUnipile}
            disabled={busy !== null}
            className="btn-secondary flex items-center gap-2 text-sm"
            title="Pull connected accounts from Unipile into the local channel list"
          >
            <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} />
            Sync from Unipile
          </button>
          {activeCount > 0 && (
            <button
              onClick={globalKillSwitch}
              disabled={busy !== null}
              className="btn-danger flex items-center gap-2"
            >
              <ShieldAlert className="w-4 h-4" />
              Kill switch — pause all
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card border-red-500/50 bg-red-500/10 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-dark-300 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Connect new channel */}
      <div className="card mb-8">
        <h3 className="mb-2">Connect a new channel</h3>
        <p className="text-dark-400 text-sm mb-4">
          Authentication completes on Unipile&apos;s hosted page. We never see or store your account password.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => connectChannel('linkedin')}
            disabled={busy !== null}
            className="card-hover flex items-center gap-3 disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-6 h-6 text-blue-400" />
            <div className="text-left">
              <p className="font-medium">LinkedIn</p>
              <p className="text-dark-500 text-xs">Connection requests + DMs</p>
            </div>
          </button>
          <button
            onClick={() => connectChannel('gmail')}
            disabled={busy !== null}
            className="card-hover flex items-center gap-3 disabled:opacity-50 cursor-pointer"
          >
            <Mail className="w-6 h-6 text-red-400" />
            <div className="text-left">
              <p className="font-medium">Gmail</p>
              <p className="text-dark-500 text-xs">Email + calendar via Google</p>
            </div>
          </button>
          <button
            onClick={() => connectChannel('outlook')}
            disabled={busy !== null}
            className="card-hover flex items-center gap-3 disabled:opacity-50 cursor-pointer"
          >
            <Mail className="w-6 h-6 text-blue-400" />
            <div className="text-left">
              <p className="font-medium">Outlook</p>
              <p className="text-dark-500 text-xs">Email + calendar via Microsoft</p>
            </div>
          </button>
        </div>
      </div>

      {/* Connected channels */}
      <div>
        <h3 className="mb-4">Connected channels ({channels.length})</h3>
        {channels.length === 0 ? (
          <div className="card text-center py-12">
            <Plus className="w-8 h-8 text-dark-500 mx-auto mb-3" />
            <p className="text-dark-400">No channels connected yet.</p>
            <p className="text-dark-500 text-sm mt-1">Connect at least one channel above to start outreach.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {channels.map((ch) => {
              const Icon = ch.channel_type === 'linkedin' ? Send : ch.channel_type === 'calendar' ? Calendar : Mail;
              const remaining = ch.daily_send_cap - ch.daily_send_count;
              const warmupComplete = ch.warmup_day >= 22;
              return (
                <div key={ch.id} className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <Icon className="w-6 h-6 text-corp-green-400 mt-1 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{ch.display_name || ch.account_identifier}</p>
                          {ch.status === 'active' && (
                            <span className="badge-green inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Active
                            </span>
                          )}
                          {ch.status === 'paused' && (
                            <span className="badge-amber inline-flex items-center gap-1">
                              <Pause className="w-3 h-3" />
                              Paused
                            </span>
                          )}
                          {ch.status === 'flagged' && (
                            <span className="badge-red inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Flagged
                            </span>
                          )}
                        </div>
                        <p className="text-dark-500 text-sm mt-0.5">
                          {ch.channel_type} · {ch.provider} · since {new Date(ch.created_at).toLocaleDateString()}
                        </p>
                        {ch.pause_reason && (
                          <p className="text-amber-400 text-sm mt-2">{ch.pause_reason}</p>
                        )}
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-dark-500 text-xs">Today</p>
                            <p>{ch.daily_send_count} / {ch.daily_send_cap}</p>
                            {remaining > 0 ? (
                              <p className="text-dark-500 text-xs">{remaining} remaining</p>
                            ) : (
                              <p className="text-amber-400 text-xs">cap reached</p>
                            )}
                          </div>
                          <div>
                            <p className="text-dark-500 text-xs">Warmup</p>
                            <p>Day {ch.warmup_day} {warmupComplete && '✓'}</p>
                            {!warmupComplete && (
                              <p className="text-dark-500 text-xs">{22 - ch.warmup_day} days to full cap</p>
                            )}
                          </div>
                          {ch.last_health_check_at && (
                            <div>
                              <p className="text-dark-500 text-xs">Last health check</p>
                              <p>{new Date(ch.last_health_check_at).toLocaleString()}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {ch.status === 'active' ? (
                        <button
                          onClick={() => pauseChannel(ch.id, 'Manual pause from channels page')}
                          disabled={busy === ch.id}
                          className="btn-secondary flex items-center gap-2 text-sm"
                        >
                          <Pause className="w-4 h-4" />
                          Pause
                        </button>
                      ) : (
                        <button
                          onClick={() => resumeChannel(ch.id)}
                          disabled={busy === ch.id}
                          className="btn-primary flex items-center gap-2 text-sm"
                        >
                          <Play className="w-4 h-4" />
                          Resume
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
