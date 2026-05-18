'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type InvitationStatus = 'loading' | 'valid' | 'expired' | 'revoked' | 'accepted' | 'not_found' | 'needs_login' | 'wrong_user' | 'error';

interface InvitationData {
  email: string;
  role: string;
  organisation: { name: string; slug: string };
  inviter_name: string | null;
  expires_at: string;
}

export default function AcceptInvitePage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');

  const [status, setStatus] = useState<InvitationStatus>('loading');
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('not_found');
      return;
    }

    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserEmail(user?.email ?? null);

      const res = await fetch(`/api/team/invite/${token}`);
      if (res.status === 404) {
        setStatus('not_found');
        return;
      }
      if (res.status === 410) {
        const body = await res.json();
        setStatus((body.status as InvitationStatus) || 'expired');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error || 'Could not load invitation');
        return;
      }

      const body = await res.json();
      const inv: InvitationData = body.invitation;
      setInvitation(inv);

      if (!user) {
        setStatus('needs_login');
      } else if (user.email?.toLowerCase() !== inv.email.toLowerCase()) {
        setStatus('wrong_user');
      } else {
        setStatus('valid');
      }
    })();
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true);
    const res = await fetch(`/api/team/invite/${token}`, { method: 'POST' });
    const body = await res.json();
    if (res.ok && body.redirect) {
      router.push(body.redirect);
    } else {
      setErrorMsg(body.error || 'Could not accept invitation');
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <header className="px-6 py-5 border-b border-dark-800">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Zap className="w-5 h-5 text-corp-green-500" />
          <span className="text-lg font-bold">InvestorPilot</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-dark-900 border border-dark-700 rounded-xl p-8">
          {status === 'loading' && (
            <p className="text-dark-300 text-center">Loading invitation…</p>
          )}

          {status === 'not_found' && (
            <>
              <h1 className="text-xl font-semibold mb-3">Invitation not found</h1>
              <p className="text-dark-300 text-sm">
                The invitation link is invalid. Ask the person who invited you to send a new one.
              </p>
            </>
          )}

          {status === 'expired' && (
            <>
              <h1 className="text-xl font-semibold mb-3">Invitation expired</h1>
              <p className="text-dark-300 text-sm">
                This invitation expired (links are valid for 7 days). Ask the inviter to resend.
              </p>
            </>
          )}

          {status === 'revoked' && (
            <>
              <h1 className="text-xl font-semibold mb-3">Invitation revoked</h1>
              <p className="text-dark-300 text-sm">
                The person who invited you has cancelled this invitation. Get in touch with them if you think this was a mistake.
              </p>
            </>
          )}

          {status === 'accepted' && (
            <>
              <h1 className="text-xl font-semibold mb-3">Already accepted</h1>
              <p className="text-dark-300 text-sm mb-4">
                You've already accepted this invitation.{' '}
                <Link href="/dashboard" className="text-corp-green-400 underline">Go to dashboard</Link>.
              </p>
            </>
          )}

          {status === 'needs_login' && invitation && (
            <>
              <h1 className="text-xl font-semibold mb-3">
                {invitation.inviter_name || 'Someone'} invited you to {invitation.organisation.name}
              </h1>
              <p className="text-dark-300 text-sm mb-5">
                Sign in (or create an account) with <strong>{invitation.email}</strong> to accept this invitation as a {invitation.role}.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
                className="btn-primary w-full block text-center"
              >
                Sign in
              </Link>
              <p className="text-dark-500 text-xs text-center mt-3">
                No account yet?{' '}
                <Link
                  href={`/signup?next=${encodeURIComponent(`/invite/accept?token=${token}`)}&email=${encodeURIComponent(invitation.email)}`}
                  className="underline hover:text-dark-300"
                >
                  Create one
                </Link>
              </p>
            </>
          )}

          {status === 'wrong_user' && invitation && (
            <>
              <h1 className="text-xl font-semibold mb-3">Wrong account</h1>
              <p className="text-dark-300 text-sm mb-4">
                This invitation was sent to <strong>{invitation.email}</strong>, but you're signed in as <strong>{currentUserEmail}</strong>.
              </p>
              <p className="text-dark-300 text-sm mb-5">
                Sign out and log back in with the invited email, or ask the inviter to resend to your current address.
              </p>
              <button
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  window.location.href = `/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`;
                }}
                className="btn-primary w-full"
              >
                Sign out and switch account
              </button>
            </>
          )}

          {status === 'valid' && invitation && (
            <>
              <h1 className="text-xl font-semibold mb-3">
                Join {invitation.organisation.name}
              </h1>
              <p className="text-dark-300 text-sm mb-5">
                {invitation.inviter_name || 'Someone'} invited you to join <strong>{invitation.organisation.name}</strong> as a <strong>{invitation.role}</strong>.
              </p>
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="btn-primary w-full disabled:opacity-60"
              >
                {accepting ? 'Joining…' : `Accept and join ${invitation.organisation.name}`}
              </button>
              {errorMsg && (
                <p className="text-red-400 text-sm mt-3">{errorMsg}</p>
              )}
            </>
          )}

          {status === 'error' && (
            <>
              <h1 className="text-xl font-semibold mb-3">Something went wrong</h1>
              <p className="text-dark-300 text-sm">{errorMsg || 'Could not load invitation.'}</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
