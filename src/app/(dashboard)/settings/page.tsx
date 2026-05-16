import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { ShieldAlert, ShieldCheck, Plug, FileText } from 'lucide-react';
import { SenderForm } from '@/components/settings/sender-form';
import { ProductPitchForm } from '@/components/settings/product-pitch-form';
import { IcpForm } from '@/components/settings/icp-form';
import { UsageCard } from '@/components/settings/usage-card';
import { InlineNameEdit } from '@/components/settings/inline-name-edit';
import { getMonthlyUsage } from '@/lib/usage/events';
import type { DraftFacility } from '@/lib/pipeline/draft-prompt';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('*, organisations(*)').single();

  // Channels summary
  const { count: activeChannels } = await supabase
    .from('client_channels')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', profile?.organisation_id || '')
    .eq('status', 'active');
  const { count: pausedChannels } = await supabase
    .from('client_channels')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', profile?.organisation_id || '')
    .eq('status', 'paused');

  // First active product — used as the editing target for the Phase B/C
  // (pitch + facilities + ICP scoring) settings cards. Multi-product orgs
  // can edit additional products via /products; the settings cards focus
  // on the primary product so the most common operator workflow is one-click.
  const { data: primaryProduct } = await supabase
    .from('products')
    .select('id, name, product_pitch, facility_summary, asset_class, geography, ticket_size_min_label, ticket_size_max_label, draft_compliance_forbidden_terms, scoring_rubric, icp_categories, icp_partner_type, icp_reject_categories, icp_special_cases')
    .eq('organisation_id', profile?.organisation_id || '')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Monthly usage snapshot (used by <UsageCard />). Skipped if there's no
  // org yet — the empty-state of the page won't reach the cards anyway.
  const usage = profile?.organisation_id
    ? await getMonthlyUsage(profile.organisation_id)
    : null;

  return (
    <div>
      <h1 className="mb-8">Settings</h1>

      <div className="space-y-6 max-w-3xl">
        {/* Usage this month — what each cap is, where the org sits against it */}
        {usage && <UsageCard usage={usage} />}

        {/* Organisation */}
        <div className="card">
          <h4 className="mb-4">Organisation</h4>
          <div className="space-y-3 text-sm">
            <InlineNameEdit
              label="Name"
              initialValue={(profile?.organisations as Record<string, string | null>)?.name ?? null}
              endpoint="/api/settings/organisation"
              placeholder="e.g. Acme Capital"
            />
            <div className="flex justify-between">
              <span className="text-dark-400">Your role</span>
              <span className="badge-green">{profile?.role}</span>
            </div>
          </div>
        </div>

        {/* Sender identity (used in every outbound DM + email) */}
        <SenderForm
          initialSenderName={(profile?.organisations as Record<string, string | null>)?.sender_name ?? null}
          initialSenderRole={(profile?.organisations as Record<string, string | null>)?.sender_role ?? null}
          initialSignatureBlock={(profile?.organisations as Record<string, string | null>)?.signature_block ?? null}
          initialSenderLinkedinUrl={(profile?.organisations as Record<string, string | null>)?.sender_linkedin_url ?? null}
          initialSenderBioOneLiner={(profile?.organisations as Record<string, string | null>)?.sender_bio_one_liner ?? null}
          initialSenderCalendarUrl={(profile?.organisations as Record<string, string | null>)?.sender_calendar_url ?? null}
        />

        {/* Product pitch + facilities (interpolated into draft system prompt) */}
        {primaryProduct && (
          <ProductPitchForm
            productId={primaryProduct.id as string}
            productName={primaryProduct.name as string}
            initialPitch={(primaryProduct.product_pitch as string | null) ?? null}
            initialFacilities={(primaryProduct.facility_summary as DraftFacility[] | null) ?? null}
            initialAssetClass={(primaryProduct.asset_class as string | null) ?? null}
            initialGeography={(primaryProduct.geography as string | null) ?? null}
            initialTicketMinLabel={(primaryProduct.ticket_size_min_label as string | null) ?? null}
            initialTicketMaxLabel={(primaryProduct.ticket_size_max_label as string | null) ?? null}
            initialForbiddenTerms={(primaryProduct.draft_compliance_forbidden_terms as string[] | null) ?? null}
          />
        )}

        {/* ICP & scoring rubric (interpolated into discover scoring prompt) */}
        {primaryProduct && (
          <IcpForm
            productId={primaryProduct.id as string}
            productName={primaryProduct.name as string}
            initialRubric={(primaryProduct.scoring_rubric as string | null) ?? null}
            initialCategories={(primaryProduct.icp_categories as string[] | null) ?? null}
            initialPartnerType={(primaryProduct.icp_partner_type as string | null) ?? null}
            initialRejectCategories={(primaryProduct.icp_reject_categories as string[] | null) ?? null}
            initialSpecialCases={(primaryProduct.icp_special_cases as string[] | null) ?? null}
          />
        )}

        {/* Sequence templates (Phase D — body content lives on each step) */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h4>Sequence templates</h4>
            <Link href="/settings/templates" className="btn-secondary text-sm">
              Manage templates
            </Link>
          </div>
          <p className="text-dark-400 text-sm">
            Edit the body and subject of each outreach step. The renderer interpolates
            <code className="text-dark-300 mx-1">{'{first_name}'}</code>,
            <code className="text-dark-300 mx-1">{'{credit_signal}'}</code>,
            <code className="text-dark-300 mx-1">{'{sender_name}'}</code> and friends per partner at send time.
          </p>
        </div>

        {/* Profile */}
        <div className="card">
          <h4 className="mb-4">Profile</h4>
          <div className="space-y-3 text-sm">
            <InlineNameEdit
              label="Name"
              initialValue={(profile?.full_name as string | null) ?? null}
              endpoint="/api/settings/profile"
              placeholder="Your name"
              maxLength={120}
            />
            <div className="flex justify-between">
              <span className="text-dark-400">Email</span>
              <span className="text-dark-300">{profile?.email || '—'}</span>
              <span className="text-xs text-dark-500 ml-2">(re-verify via password reset to change)</span>
            </div>
          </div>
        </div>

        {/* Channels summary + kill switch entry */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h4>Channels & safety</h4>
            <Link href="/channels" className="btn-secondary text-sm flex items-center gap-2">
              <Plug className="w-4 h-4" />
              Manage channels
            </Link>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-dark-400">Active channels</span>
              <span className="badge-green">{activeChannels || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-dark-400">Paused channels</span>
              <span className={pausedChannels ? 'badge-amber' : 'badge-grey'}>{pausedChannels || 0}</span>
            </div>
            <div className="pt-3 border-t border-dark-800">
              <p className="text-dark-300 mb-2 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                Kill switch
              </p>
              <p className="text-dark-500 text-xs mb-3">
                Pause every active channel in one click. Useful when a campaign needs an immediate stop or a
                Unipile-level event is suspected. The kill switch lives on the Channels page.
              </p>
              <Link href="/channels" className="btn-danger inline-flex items-center gap-2 text-sm">
                <ShieldAlert className="w-4 h-4" />
                Go to kill switch
              </Link>
            </div>
          </div>
        </div>

        {/* Compliance mode — reference card. Actual selection is per
            project/product (migration 026). This card just shows what
            rulesets exist + points the operator at the right place to
            switch them. */}
        <div className="card">
          <h4 className="mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-corp-green-400" />
            Compliance rulesets (reference)
          </h4>
          <p className="text-dark-400 text-sm mb-4">
            Compliance rulesets are picked <b>per project and per product</b> — open the project or product card to switch ruleset for that offering. The list below is the catalogue of available rulesets.
          </p>
          <div className="space-y-2 text-sm">
            {[
              { id: 'standard', label: 'Standard — light-touch (default for new projects)', desc: 'Blocks only "guarantee" / "risk-free". Right for most SaaS, EdTech, B2B, non-regulated outreach.' },
              { id: 'finance_au_senior_debt', label: 'Finance AU — Senior debt', desc: 'Strict. Blocks tokenisation/crypto/yield/double-digit, requires $-figures from approved set. Right for AU credit / wholesale debt to lenders.' },
              { id: 'finance_au_wholesale', label: 'Finance AU — Wholesale (reserved)', desc: 'Reserved for the deferred $125K wholesale junior-debt channel. Currently mirrors senior_debt.' },
              { id: 'finance_us', label: 'Finance US (reserved)', desc: 'Reserved for future US Reg D expansion. Currently mirrors standard.' },
            ].map(mode => (
              <div
                key={mode.id}
                className="p-3 rounded-lg border border-dark-700 bg-dark-900"
              >
                <div className="font-medium text-dark-200">{mode.label}</div>
                <p className="text-xs text-dark-500 mt-0.5">{mode.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-dark-500 text-xs mt-3">
            Pick the ruleset per project on the <Link href="/projects" className="text-corp-green-400 underline">Projects</Link> card (Edit) or per product on the <Link href="/products" className="text-corp-green-400 underline">Products</Link> card. New sequences generated after the change inherit the new ruleset; existing in-flight messages keep theirs.
          </p>
        </div>

        {/* API services */}
        <div className="card">
          <h4 className="mb-4">API services</h4>
          <p className="text-dark-400 text-sm mb-4">
            API keys are managed via environment variables. Contact admin to update.
          </p>
          <div className="space-y-2 text-sm">
            {['Anthropic / OpenRouter', 'Hunter.io', 'Brave Search', 'Resend', 'Unipile'].map((service) => (
              <div key={service} className="flex items-center justify-between py-2 border-b border-dark-800 last:border-0">
                <span>{service}</span>
                <span className="badge-green">Configured via env</span>
              </div>
            ))}
          </div>
        </div>

        {/* Documentation */}
        <div className="card">
          <h4 className="mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-corp-green-400" />
            Documentation
          </h4>
          <p className="text-dark-400 text-sm mb-4">
            Operating documentation lives in <code className="text-dark-300">docs/sprint-0/</code>.
          </p>
          <div className="space-y-1.5 text-sm">
            <p>· Sprint 0 README — orchestration + status</p>
            <p>· Senior Debt Brief v3 — source of truth for offering + ICP</p>
            <p>· File 09 — operational ICP + scoring rubric</p>
            <p>· File 02 — funnel math + dashboard spec</p>
            <p>· Files 06 + 07 — LinkedIn + email message templates</p>
            <p>· File 10 — SPV term sheets</p>
          </div>
        </div>
      </div>
    </div>
  );
}
