// Auth routes render at request time, never statically prerendered at build.
// The pages are 'use client' and create a Supabase browser client during render;
// if a NEXT_PUBLIC_SUPABASE_* env is ever missing at build, static prerendering
// would crash the WHOLE build (2026-06-13 incident: anon key was Production-unset).
// force-dynamic makes a missing public env a runtime concern, not a build-breaker.
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
