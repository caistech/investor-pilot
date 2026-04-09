'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { full_name: fullName, org_name: orgName },
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
        <div className="card max-w-md w-full text-center">
          <h2 className="mb-4">Check your email</h2>
          <p className="text-dark-400">
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
            Click the link to activate your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
      <div className="card max-w-md w-full">
        <h2 className="text-center mb-2">Create your account</h2>
        <p className="text-dark-400 text-center mb-8">Start finding partners with AI</p>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm text-dark-300 mb-1">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-corp-green-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1">Company name</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-corp-green-500 focus:outline-none"
              required
            />
          </div>
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
              minLength={8}
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-dark-400 text-sm text-center mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-corp-green-400 hover:text-corp-green-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
