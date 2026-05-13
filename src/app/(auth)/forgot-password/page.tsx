'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
        <div className="card max-w-md w-full text-center">
          <h2 className="mb-4">Check your email</h2>
          <p className="text-dark-400 mb-6">
            If an account exists for <strong className="text-white">{email}</strong>, we sent a
            password-reset link. Click it to choose a new password.
          </p>
          <Link href="/login" className="text-corp-green-400 hover:text-corp-green-300 text-sm">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
      <div className="card max-w-md w-full">
        <h2 className="text-center mb-2">Reset your password</h2>
        <p className="text-dark-400 text-center mb-8">
          Enter the email tied to your account. We&apos;ll send a link to set a new password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-dark-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-corp-green-500 focus:outline-none"
              required
              autoFocus
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" disabled={loading || !email} className="btn-primary w-full disabled:opacity-50">
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="text-dark-400 text-sm text-center mt-6">
          Remembered it?{' '}
          <Link href="/login" className="text-corp-green-400 hover:text-corp-green-300">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
