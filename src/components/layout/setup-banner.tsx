import Link from 'next/link';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { getSetupState, listSetupGaps } from '@/lib/onboarding/setup-state';
import { createClient } from '@/lib/supabase/server';

/**
 * Persistent setup-checklist banner that renders at the top of every
 * dashboard page until every required prerequisite is met. Lists each
 * gap on its own row with a deep-link to fix it.
 *
 * Renders nothing when setup is complete, so users only ever see it
 * when there's a real action they need to take. Server-rendered — no
 * client-side hydration cost when it's hidden.
 */
export async function SetupBanner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_organisation_id')
    .single();
  if (!profile?.active_organisation_id) return null;

  const state = await getSetupState(profile.active_organisation_id);
  if (state.allDone) return null;

  const gaps = listSetupGaps(state);
  if (gaps.length === 0) return null;

  return (
    <div className="card mb-6 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-400">
            Finish setting up — {gaps.length} {gaps.length === 1 ? 'item' : 'items'} left
          </p>
          <p className="text-dark-400 text-xs mt-0.5 mb-3">
            The pipeline can&apos;t run end-to-end until every prerequisite below is configured. Click any item to jump straight to it.
          </p>
          <ul className="space-y-1.5">
            {gaps.map((gap) => (
              <li key={gap.key}>
                <Link
                  href={gap.href}
                  className="inline-flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  {gap.label}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
