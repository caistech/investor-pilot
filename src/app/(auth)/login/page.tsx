'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      window.location.href = '/dashboard';
    }
  }

  async function handleMagicLink() {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
    } else {
      setError(null);
      alert('Check your email for the login link.');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
      <div className="card max-w-md w-full">
        <h2 className="text-center mb-2">Welcome back</h2>
        <p className="text-dark-400 text-center mb-8">Sign in to PartnerPilot</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-dark-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-corp-green-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-corp-green-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <button
            type="button"
            onClick={handleMagicLink}
            disabled={loading || !email}
            className="btn-secondary w-full disabled:opacity-50"
          >
            Send magic link
          </button>
        </form>

        <p className="text-dark-400 text-sm text-center mt-6">
          No account?{' '}
          <Link href="/signup" className="text-corp-green-400 hover:text-corp-green-300">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
