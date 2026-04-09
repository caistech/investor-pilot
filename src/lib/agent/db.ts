import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Authenticate the request and return both the user and a service client for DB writes.
 * API routes use the cookie client for auth, then the service client for all
 * database operations to bypass RLS (auth is already verified).
 */
export async function authenticateAndGetDb() {
  const authClient = createClient();
  const { data: { user } } = await authClient.auth.getUser();

  if (!user) {
    return { user: null, db: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const db = createServiceClient();
  return { user, db, error: null };
}
