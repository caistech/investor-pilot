'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Users, Mail, UserPlus, Link2, Trash2, ArrowLeft, ShieldCheck, Loader2, AlertCircle, Clock, LogOut } from 'lucide-react';

interface Member {
  id: string;
  full_name: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
  channels: { linkedin: number; email: number };
  is_self: boolean;
}

interface PendingInvitation {
  id: string;
  token: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

export default function TeamSettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const settingsHref = slug ? `/org/${slug}/settings` : '/settings';

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<'owner' | 'admin' | 'member' | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch('/api/team/members'),
        fetch('/api/team/invitations'),
      ]);
      if (!membersRes.ok) throw new Error((await membersRes.json()).error || 'Failed to load team');
      const membersJson = (await membersRes.json()) as { members: Member[] };
      setMembers(membersJson.members);
      const self = membersJson.members.find((m) => m.is_self);
      setCurrentRole(self?.role ?? null);

      if (invitationsRes.ok) {
        const invitationsJson = (await invitationsRes.json()) as { invitations: PendingInvitation[] };
        setInvitations(invitationsJson.invitations);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Invite failed');
      if (json.already_pending) {
        setMessage(`${inviteEmail} already has a pending invitation. They can still use the link in their first email — or revoke it below to send a fresh one.`);
      } else if (json.email_sent === false) {
        setMessage(`Invitation created for ${inviteEmail}, but the email didn't send. Copy the accept link from the Pending invitations list below.`);
      } else {
        setMessage(`Invite sent to ${inviteEmail}. They'll get an email with a link to join the team.`);
      }
      setInviteEmail('');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, role: 'owner' | 'admin' | 'member') {
    setError(null);
    try {
      const res = await fetch(`/api/team/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Role change failed');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove(memberId: string, memberLabel: string) {
    if (!confirm(`Remove ${memberLabel} from the team? Their LinkedIn / email channels in this org will be revoked so the sequencer stops sending via them. They keep their account and their access to any other orgs they belong to.`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/team/members/${memberId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Remove failed');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleLeaveOrg(selfId: string) {
    if (!confirm('Leave this organisation? You’ll lose access to its data; the inviter can add you back later. Your other orgs are unaffected.')) return;
    setError(null);
    try {
      const res = await fetch(`/api/team/members/${selfId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Leave failed');
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRevoke(token: string, email: string) {
    if (!confirm(`Revoke the pending invitation for ${email}? Their accept link will stop working.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/team/invite/${token}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Revoke failed');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const canManage = currentRole === 'owner' || currentRole === 'admin';
  const canChangeRoles = currentRole === 'owner';

  return (
    <div>
      <Link href={settingsHref} className="flex items-center gap-2 text-dark-400 hover:text-white mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to settings
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <Users className="w-6 h-6 text-corp-green-400" />
        <h1>Team</h1>
      </div>
      <p className="text-dark-400 mb-8">
        Shared dataroom (templates, products, projects, KB) with per-member outreach. Each member connects their own LinkedIn and email — the sequencer sends from the right account automatically.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span className="text-sm">{error}</span>
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 rounded-lg bg-corp-green-500/10 border border-corp-green-500/30 text-corp-green-300 text-sm">
          {message}
        </div>
      )}

      {canManage && (
        <div className="card mb-8">
          <h3 className="mb-3 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-corp-green-400" /> Invite a teammate
          </h3>
          <p className="text-dark-400 text-sm mb-4">
            They&apos;ll receive an email with a link to join this team. Works for existing InvestorPilot accounts as well as brand-new ones.
          </p>
          <form onSubmit={handleInvite} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs text-dark-400 mb-1">Email</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                required
                className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2 text-base sm:text-sm focus:border-corp-green-500 focus:outline-none"
              />
            </div>
            {currentRole === 'owner' && (
              <div>
                <label className="block text-xs text-dark-400 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                  className="bg-dark-800 border border-dark-700 rounded px-3 py-2 text-sm focus:border-corp-green-500 focus:outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin (can invite others)</option>
                </select>
              </div>
            )}
            <button type="submit" disabled={inviting || !inviteEmail.trim()} className="btn-primary disabled:opacity-50">
              {inviting ? <><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Sending…</> : 'Send invite'}
            </button>
          </form>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="card mb-8">
          <h3 className="mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" /> Pending invitations
          </h3>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg">
                <Mail className="w-4 h-4 text-dark-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{inv.email}</div>
                  <div className="text-xs text-dark-500">
                    Invited as <span className="uppercase tracking-wide">{inv.role}</span> · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                {canManage && (
                  <button
                    onClick={() => handleRevoke(inv.token, inv.email)}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1 border border-red-500/30 rounded"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="mb-4">Members</h3>
        {loading ? (
          <div className="text-center py-8 text-dark-500"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              const label = m.full_name || m.email || m.id;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 p-3 bg-dark-800 rounded-lg">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-dark-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {(m.full_name || m.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {label}
                        {m.is_self && <span className="text-xs text-dark-500">(you)</span>}
                      </div>
                      <div className="text-xs text-dark-500 truncate">{m.email}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span title="LinkedIn accounts connected" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${m.channels.linkedin > 0 ? 'bg-blue-500/15 text-blue-300' : 'bg-dark-700 text-dark-500'}`}>
                      <Link2 className="w-3 h-3" /> {m.channels.linkedin}
                    </span>
                    <span title="Email accounts connected" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${m.channels.email > 0 ? 'bg-purple-500/15 text-purple-300' : 'bg-dark-700 text-dark-500'}`}>
                      <Mail className="w-3 h-3" /> {m.channels.email}
                    </span>
                  </div>

                  {canChangeRoles && !m.is_self ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value as 'owner' | 'admin' | 'member')}
                      className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-xs"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs uppercase tracking-wide ${
                      m.role === 'owner' ? 'bg-corp-green-500/15 text-corp-green-300' :
                      m.role === 'admin' ? 'bg-amber-500/15 text-amber-300' :
                      'bg-dark-700 text-dark-300'
                    }`}>
                      {m.role === 'owner' && <ShieldCheck className="w-3 h-3" />}
                      {m.role}
                    </span>
                  )}

                  {canChangeRoles && !m.is_self && m.role !== 'owner' && (
                    <button
                      onClick={() => handleRemove(m.id, label)}
                      className="text-red-400 hover:text-red-300 p-1"
                      title="Remove from team"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                  {m.is_self && m.role !== 'owner' && (
                    <button
                      onClick={() => handleLeaveOrg(m.id)}
                      className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 text-xs px-2 py-1 border border-amber-500/30 rounded"
                      title="Leave this organisation"
                    >
                      <LogOut className="w-3 h-3" /> Leave
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-8 text-xs text-dark-500 max-w-2xl">
        <p className="mb-2"><strong className="text-dark-300">How team outreach works:</strong></p>
        <ul className="space-y-1 list-disc list-outside ml-5">
          <li>Templates, products, projects, knowledge base, and prospects are <strong>shared</strong> across the org — every member sees the same data.</li>
          <li>Each member connects their <strong>own LinkedIn + email</strong> on the Channels page. The sequencer picks the right member&apos;s account when sending steps they created.</li>
          <li>If a member&apos;s channel disconnects, their steps wait (no fallback to another member&apos;s account) so the recipient always sees the expected sender.</li>
          <li>Admins can invite others as members. Only owners can promote to admin/owner or remove members. Members can leave the org themselves.</li>
        </ul>
      </div>
    </div>
  );
}
