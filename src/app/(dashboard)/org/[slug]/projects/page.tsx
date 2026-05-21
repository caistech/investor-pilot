// @explanatory-header-exempt — nested workflow page; entry-point header lives on the parent surface
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, Briefcase, Sparkles, Loader2, ChevronDown, ChevronRight, Pencil, Trash2, Power, PowerOff, Target } from 'lucide-react';
import Link from 'next/link';
import type { Project, FundingType } from '@/lib/types';
import { FUNDING_TYPE_GROUPS, capitalProviderTerm, PARTNER_TYPE_OPTIONS, partnerTypeForFundingType } from '@/lib/types';
import SourceManager from '@/components/products/source-manager';
import { GenerateRubricButton } from '@/components/products/generate-rubric-button';
import { GenerateSequenceButton } from '@/components/settings/generate-sequence-button';
import { PoolStatChip } from '@/components/pool/pool-stat-chip';
import ProjectInterviewWizard from '@/components/projects/interview-wizard';
import type { SynthesizedProjectProfile } from '@/lib/projects/interview-synthesizer';

/**
 * Detail-field labels that adapt to the project's funding_type. An equity
 * Seed round shows "Investor Outcomes / Investor Verticals / Buyer Title
 * at Investor Firm"; a senior-debt project shows "Lender Outcomes /
 * Lender Verticals / Buyer Title at Lender Firm". Pre-migration-027 the
 * labels were hard-coded "Lender X" — a leftover from when this was an
 * F2K-debt-only tool — and reading them on an equity card was incoherent.
 */
function detailFieldsFor(fundingType: FundingType | null | undefined): Array<{ key: keyof Project; label: string }> {
  const { noun } = capitalProviderTerm(fundingType);
  return [
    { key: 'core_mechanism', label: `Core Mechanism (${noun.toLowerCase()} perspective)` },
    { key: 'customer_outcomes', label: `${noun} Outcomes` },
    { key: 'icp_company_size', label: `${noun} Company Size` },
    { key: 'icp_stage', label: `${noun} Stage / Maturity` },
    { key: 'icp_verticals', label: `${noun} Verticals` },
    { key: 'icp_buyer_title', label: `Buyer Title at ${noun} Firm` },
    { key: 'icp_user_title', label: `User Title at ${noun} Firm` },
    { key: 'icp_stack_tools', label: `${noun} Stack Tools` },
    { key: 'traction_arr', label: 'Proof Points' },
    { key: 'traction_customers', label: 'Existing Participants' },
    { key: 'partner_types', label: 'Partner Type' },
    { key: 'exclusions', label: 'Exclusions' },
  ];
}

const EMPTY_FORM: Omit<Project, 'id' | 'organisation_id' | 'created_at' | 'updated_at'> = {
  sponsor: '',
  name: '',
  description: '',
  // project_type intentionally omitted — deprecated since migration 027,
  // funding_type is the operator-facing field now. The Project interface
  // still carries it for legacy compat (DB column not dropped); new rows
  // land with project_type = null.
  project_type: null,
  funding_type: null,
  funding_target: '',
  geography: '',
  asset_class: '',
  pitch_deck_url: '',
  one_pager_url: '',
  compliance_mode: 'standard',
  core_mechanism: '',
  customer_outcomes: '',
  icp_company_size: '',
  icp_stage: '',
  icp_verticals: '',
  icp_buyer_title: '',
  icp_user_title: '',
  icp_stack_tools: '',
  traction_arr: '',
  traction_customers: '',
  partner_types: 'lender',
  exclusions: '',
  is_active: true,
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  // Funding-side parallel to the Product Interview entry point. Operator
  // answers 8 benefit-framed questions; Claude synthesizes the structured
  // project profile and we drop it into the existing manual form for
  // review/edit before save. Same anti-mis-positioning intent as the
  // product side — sponsor + structure + asset class are forced into
  // separate, well-framed buckets instead of bleeding into each other.
  const [showInterview, setShowInterview] = useState(false);
  // True while the operator is reviewing a synthesized profile in the full
  // edit form (before the first save). Bypasses the KB-first gate (which
  // expects draftProjectId / SourceManager) and routes straight into the
  // edit form, but keeps editingId null so handleSave still takes the
  // insert path. Cleared after save / cancel.
  const [synthesizedDraft, setSynthesizedDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // New-project KB-first flow: when set, the modal switches from name-only to
  // SourceManager. Operator uploads docs/URLs/text directly into the modal
  // and clicks Auto-fill from KB; the project gets fully populated from the
  // canonical material instead of typed-in by hand.
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [draftProjectName, setDraftProjectName] = useState<string>('');
  // Funding type captured on the very first KB-first step so the new project
  // row lands with this column already set — drives discovery + scoring
  // immediately, before the operator even uploads source docs. Falls back
  // to null (editable later via Edit) if the operator skips it.
  const [draftFundingType, setDraftFundingType] = useState<FundingType | ''>('');
  // Description captured at create-time. Required by both Generate Rubric
  // and Generate Sequence — if it's blank, the project lands with both
  // unlock paths deadlocked on "no description yet" until the operator
  // notices the Edit-and-fix flow. Capturing here removes that trap.
  const [draftDescription, setDraftDescription] = useState<string>('');
  // Sponsor is interpolated into every outbound message ("F2K Capital is
  // raising...", "Koch Capital Advisory is placing..."). Carries trust
  // signal — anonymous sponsor is a red flag to any serious investor.
  // Optional at create time; auto-fill from KB will populate it if blank.
  const [draftSponsor, setDraftSponsor] = useState<string>('');
  const supabase = createClient();

  useEffect(() => {
    loadProjects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getOrgId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organisation_id')
      .eq('id', user.id)
      .single();
    return profile?.active_organisation_id || null;
  }

  async function loadProjects() {
    const orgId = await getOrgId();
    if (!orgId) return;
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });
    if (data) setProjects(data as Project[]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const orgId = await getOrgId();
    if (!orgId) {
      setError('Could not find your organisation. Try refreshing.');
      setLoading(false);
      return;
    }

    if (editingId) {
      const { error: updateError } = await supabase.from('projects').update(form).eq('id', editingId);
      if (updateError) setError(updateError.message);
    } else {
      const { error: insertError } = await supabase
        .from('projects')
        .insert({ ...form, organisation_id: orgId });
      if (insertError) setError(insertError.message);
    }

    if (!error) {
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setSynthesizedDraft(false);
      loadProjects();
    }
    setLoading(false);
  }

  function startEdit(project: Project) {
    // Scroll to the top of the page so the Edit form (which renders
    // above the project list) is visible. Without this the operator
    // clicks Edit inside an expanded card, the form appears at the
    // top, but they're still looking at the card and it looks like
    // nothing happened. Same fix as finishDraft auto-scrolls to the
    // newly-created project.
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
    setForm({
      sponsor: project.sponsor || '',
      name: project.name,
      description: project.description || '',
      project_type: project.project_type,
      funding_type: project.funding_type ?? null,
      funding_target: project.funding_target || '',
      geography: project.geography || '',
      asset_class: project.asset_class || '',
      pitch_deck_url: project.pitch_deck_url || '',
      one_pager_url: project.one_pager_url || '',
      compliance_mode: project.compliance_mode || 'standard',
      core_mechanism: project.core_mechanism || '',
      customer_outcomes: project.customer_outcomes || '',
      icp_company_size: project.icp_company_size || '',
      icp_stage: project.icp_stage || '',
      icp_verticals: project.icp_verticals || '',
      icp_buyer_title: project.icp_buyer_title || '',
      icp_user_title: project.icp_user_title || '',
      icp_stack_tools: project.icp_stack_tools || '',
      traction_arr: project.traction_arr || '',
      traction_customers: project.traction_customers || '',
      partner_types: project.partner_types || 'lender',
      exclusions: project.exclusions || '',
      is_active: project.is_active,
    });
    setEditingId(project.id);
    setShowForm(true);
    setSynthesizedDraft(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project? Its Knowledge Base sources will also be deleted. Discovered prospects keep their reference but lose the link.')) return;
    await supabase.from('projects').delete().eq('id', id);
    loadProjects();
  }

  async function toggleActive(p: Project) {
    await supabase.from('projects').update({ is_active: !p.is_active }).eq('id', p.id);
    loadProjects();
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDraftProjectId(null);
    setDraftProjectName('');
    setDraftFundingType('');
    setDraftDescription('');
    setDraftSponsor('');
    setSynthesizedDraft(false);
  }

  async function createDraftProject() {
    const orgId = await getOrgId();
    if (!orgId) {
      setError('Could not find your organisation.');
      return;
    }
    setLoading(true);
    setError(null);
    const placeholderName = draftProjectName.trim() || `Draft project (${new Date().toLocaleString('en-AU')})`;
    const insertPayload: Record<string, unknown> = { organisation_id: orgId, name: placeholderName };
    if (draftFundingType) {
      insertPayload.funding_type = draftFundingType;
      // Auto-set partner_types from funding_type so the project row lands
      // with consistent who-we're-reaching tagging — eliminates the
      // "funding_type=seed but partner_types=lender from a previous
      // default" inconsistency. Operator can override later via Edit.
      insertPayload.partner_types = partnerTypeForFundingType(draftFundingType);
    }
    if (draftDescription.trim()) insertPayload.description = draftDescription.trim();
    if (draftSponsor.trim()) insertPayload.sponsor = draftSponsor.trim();
    const { data, error: insertError } = await supabase
      .from('projects')
      .insert(insertPayload)
      .select('id')
      .single();
    setLoading(false);
    if (insertError || !data) {
      setError(insertError?.message || 'Failed to create draft');
      return;
    }
    setDraftProjectId(data.id);
    loadProjects();
  }

  function finishDraft() {
    // Capture the new project id BEFORE clearing draft state so we can
    // auto-expand its card after the list reloads. Without this the
    // operator gets dumped at the top of the projects list and has to
    // hunt for the project they just created — three extra clicks
    // before they can hit Auto-fill, Generate Rubric, etc.
    const newId = draftProjectId;
    setShowForm(false);
    setDraftProjectId(null);
    setDraftProjectName('');
    setDraftFundingType('');
    setDraftDescription('');
    setDraftSponsor('');
    loadProjects();
    if (newId) {
      setExpandedProject(newId);
      // Defer scroll until React paints the expanded card.
      setTimeout(() => {
        document.getElementById(`project-${newId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  // Find Investors state
  const [findingFor, setFindingFor] = useState<string | null>(null);
  // Default to classic LinkedIn + Brave. Sales Nav requires additional rich
  // filters our wrapper doesn't send yet (proven returning 0 in production);
  // operator can opt-in once SN wrapper is validated separately.
  const [findSources, setFindSources] = useState<Array<'linkedin' | 'sales_nav' | 'brave'>>(['linkedin', 'brave']);
  const [findResult, setFindResult] = useState<{
    projectId: string;
    queries_used: Array<{ query: string; rationale: string; category: string; intended_source?: string }>;
    candidates_found: number;
    candidates_unique: number;
    candidates_scored: number;
    candidates_failed: number;
    candidates_discarded: number;
    tier_breakdown?: { '1st'?: number; '2nd'?: number; cold?: number };
    top_results: Array<{ company_name: string; weighted_score: number; source: string; partner_id?: string; network_distance?: string }>;
    search_errors?: Array<{ query: string; source: string; tier: string; error: string }>;
    scoring_errors?: string[];
    error?: string;
  } | null>(null);

  function toggleFindSource(s: 'linkedin' | 'sales_nav' | 'brave') {
    setFindSources(prev => {
      if (prev.includes(s)) {
        const next = prev.filter(p => p !== s);
        return next.length === 0 ? prev : next;
      }
      return [...prev, s];
    });
  }

  async function findInvestorsForProject(projectId: string) {
    if (!confirm('Run multi-query discovery batch for this project? ~2-5 minutes. Up to 50 candidates scored.')) return;
    setFindingFor(projectId);
    setFindResult(null);
    try {
      const res = await fetch('/api/pipeline/discover-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, sources: findSources }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFindResult({
          projectId,
          queries_used: [],
          candidates_found: 0,
          candidates_unique: 0,
          candidates_scored: 0,
          candidates_failed: 0,
          candidates_discarded: 0,
          top_results: [],
          error: data.error || 'Discovery failed',
        });
      } else {
        setFindResult({
          projectId,
          queries_used: data.queries_used || [],
          candidates_found: data.candidates_found || 0,
          candidates_unique: data.candidates_unique || 0,
          candidates_scored: data.candidates_scored || 0,
          candidates_failed: data.candidates_failed || 0,
          candidates_discarded: data.candidates_discarded || 0,
          tier_breakdown: data.tier_breakdown,
          top_results: data.top_results || [],
          search_errors: data.search_errors || [],
          scoring_errors: data.scoring_errors || [],
        });
      }
    } catch (err) {
      setFindResult({
        projectId,
        queries_used: [],
        candidates_found: 0,
        candidates_unique: 0,
        candidates_scored: 0,
        candidates_failed: 0,
        candidates_discarded: 0,
        top_results: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFindingFor(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Projects</h1>
          <p className="text-dark-400 mt-1">Investable projects in your portfolio. Each one drives its own lender discovery and outreach campaign.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setShowInterview(true); setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); setDraftProjectId(null); }}
            className="btn-primary flex items-center gap-2"
            title="Answer 8 short questions about what you're raising; the system synthesises the project profile for review and edit before save. Recommended for new projects — produces cleaner sponsor + structure + ICP framing than typing the full form."
          >
            <Sparkles className="w-4 h-4" /> Use AI Interview
          </button>
          <button
            onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); setShowInterview(false); setSynthesizedDraft(false); }}
            className="btn-secondary flex items-center gap-2"
            title="Type all project fields directly — useful if you've already drafted the copy elsewhere or want to keep the KB-first workflow."
          >
            <Plus className="w-4 h-4" /> Add manually
          </button>
        </div>
      </div>

      {showInterview && (
        <div className="mb-8">
          <ProjectInterviewWizard
            onSynthesized={(profile: SynthesizedProjectProfile) => {
              // Populate the existing manual form so the operator can review
              // and edit before save. funding_type comes back as a hint slug;
              // operator confirms in the dropdown. partner_types may map to
              // an enum the form uses ('investor' / 'lender' / 'lp' /
              // 'strategic') — we pass it through and the form auto-syncs to
              // funding_type via partnerTypeForFundingType() once that's
              // picked.
              const fundingTypeHint = (profile.funding_type_hint || '').trim();
              const isValidFundingType = !!fundingTypeHint && fundingTypeHint !== 'other';
              setForm({
                sponsor: profile.sponsor,
                name: profile.name,
                description: profile.description,
                project_type: null,
                funding_type: (isValidFundingType ? fundingTypeHint : null) as Project['funding_type'],
                funding_target: profile.funding_target,
                geography: profile.geography,
                asset_class: profile.asset_class,
                pitch_deck_url: '',
                one_pager_url: '',
                compliance_mode: 'standard',
                core_mechanism: profile.core_mechanism,
                customer_outcomes: profile.customer_outcomes,
                icp_company_size: profile.icp_company_size,
                icp_stage: profile.icp_stage,
                icp_verticals: profile.icp_verticals,
                icp_buyer_title: profile.icp_buyer_title,
                icp_user_title: profile.icp_user_title,
                icp_stack_tools: profile.icp_stack_tools,
                traction_arr: profile.traction_arr,
                traction_customers: profile.traction_customers,
                partner_types: profile.partner_types || 'lender',
                exclusions: profile.exclusions,
                is_active: true,
              });
              setEditingId(null);
              setSynthesizedDraft(true); // skip KB-first gate, render the full edit form for review
              setShowInterview(false);
              setShowForm(true);
            }}
            onCancel={() => setShowInterview(false)}
          />
        </div>
      )}

      {showForm && !editingId && !synthesizedDraft && (
        <div className="card mb-8">
          <h3 className="mb-4">New Project</h3>

          {!draftProjectId ? (
            <div className="space-y-5">
              <div className="p-4 rounded-lg bg-corp-green-500/10 border border-corp-green-500/30 text-sm text-dark-200">
                <p className="font-semibold text-corp-green-400 mb-1 text-base">KB-first project creation</p>
                <p>
                  Upload your Investment Memorandum, Finance Submission, term sheet PDFs (and add URLs / pasted text if you have any). The AI extracts the sponsor, funding terms, geography, asset class — everything — from those sources. Pick the funding type below so discovery starts on the right track from the very first run.
                </p>
              </div>

              {/* === ESSENTIALS — same prominence as the Edit form. Funding
                  Type is the only field that can't be reliably auto-filled
                  from docs (the AI doesn't know whether a $50M raise is
                  Series A vs growth equity vs senior debt without operator
                  judgement), so it's the one mandatory pick here. */}
              <div className="p-5 rounded-xl bg-corp-green-500/5 border-2 border-corp-green-500/40">
                <div className="flex items-baseline justify-between mb-4">
                  <h4 className="text-base text-corp-green-400 font-semibold uppercase tracking-wide">Pick before upload</h4>
                  <span className="text-xs text-dark-300">Sets the filter for everything downstream.</span>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-base text-white font-semibold mb-2">
                      Funding Type <span className="text-corp-green-400">*</span>
                      <span className="text-sm text-dark-300 font-normal ml-2">— what kind of capital are you raising?</span>
                    </label>
                    <select
                      value={draftFundingType}
                      onChange={(e) => setDraftFundingType(e.target.value as FundingType | '')}
                      className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                    >
                      <option value="">— Select the funding scenario —</option>
                      {FUNDING_TYPE_GROUPS.map(group => (
                        <optgroup key={group.category} label={group.category}>
                          {group.options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="text-sm text-dark-300 mt-2">
                      Discovery looks for the matching investor profile; the scorer rejects mismatches as out_of_scope. Picking the right value here is the difference between a list of real prospects and a list of irrelevant VCs.
                    </p>
                  </div>

                  <div>
                    <label className="block text-base text-white font-semibold mb-2">
                      Project Name
                      <span className="text-sm text-dark-300 font-normal ml-2">(optional — AI will extract from your docs if blank)</span>
                    </label>
                    <input
                      value={draftProjectName}
                      onChange={(e) => setDraftProjectName(e.target.value)}
                      className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                      placeholder="e.g. Branscombe Estate — Senior Construction Debt"
                    />
                  </div>

                  {/* Sponsor — the entity raising the capital. Trust signal
                      in every outreach line ("Koch Capital Advisory is
                      placing...", "F2K Capital is raising..."). Anonymous
                      sponsor is a red flag to any serious investor, so we
                      capture it at create time when the operator's mental
                      context is already on it. */}
                  <div>
                    <label className="block text-base text-white font-semibold mb-2">
                      Sponsor
                      <span className="text-sm text-dark-300 font-normal ml-2">— the entity raising the capital (named in every outreach)</span>
                    </label>
                    <input
                      value={draftSponsor}
                      onChange={(e) => setDraftSponsor(e.target.value)}
                      className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                      placeholder="e.g. Koch Capital Advisory, F2K Capital, LingoPure Pty Ltd"
                    />
                    <p className="text-sm text-dark-300 mt-2">
                      Your firm or the firm raising on behalf of the underlying asset. Investors look this up before opening anything else — anonymous sponsor reads as a red flag. Optional now; auto-fill from KB will populate if blank, but typing it now means the first cold draft you see is already credibility-anchored.
                    </p>
                  </div>

                  {/* Description / investment thesis. Gates Generate Rubric +
                      Generate Sequence — without one, the project lands
                      blocked on both. Auto-fill from KB fills it in once
                      docs are uploaded, but for operators who want to
                      start writing the pitch now (or who have a clear
                      one-paragraph thesis already), capturing it here
                      removes a downstream blocker. */}
                  <div>
                    <label className="block text-base text-white font-semibold mb-2">
                      Description / Investment thesis
                      <span className="text-sm text-dark-300 font-normal ml-2">(optional now — required before Generate Rubric / Sequence; Auto-fill from KB will fill it in if you skip)</span>
                    </label>
                    <textarea
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      rows={4}
                      className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none resize-y"
                      placeholder="One paragraph: what's being funded, structure (debt/equity/mezz), size, geography, and the angle that makes it interesting to an investor."
                    />
                    <p className="text-sm text-dark-300 mt-2">
                      Two paths: write it now if your thesis is already clear, OR leave blank and let Auto-fill from KB extract it from your uploaded materials. Either way, this must exist before you can generate the rubric or sequence.
                    </p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={createDraftProject}
                  disabled={loading}
                  className="btn-primary text-base px-5 py-3 disabled:opacity-50"
                >
                  {loading ? 'Creating…' : 'Next: Upload sources →'}
                </button>
                <button onClick={cancelForm} className="btn-secondary text-base px-5 py-3">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-dark-300">
                <p className="font-medium text-blue-400 mb-1">Step 2 — Add sources, then auto-fill</p>
                <p className="text-dark-400">
                  Upload your Investment Memorandum / Finance Submission PDFs, add URLs, paste text. Once at least one source is added and processed, click <span className="text-corp-green-400">Auto-fill from KB</span> to populate all project fields from the canonical material.
                </p>
              </div>

              <SourceManager projectId={draftProjectId} />

              <div className="flex gap-3">
                <button onClick={finishDraft} className="btn-secondary">Done</button>
                <p className="text-dark-500 text-xs self-center">
                  You can always edit fields manually later via the project&apos;s Edit button.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {showForm && (editingId || synthesizedDraft) && (
        <form onSubmit={handleSave} className="card mb-8">
          <h3 className="mb-4">{synthesizedDraft ? 'Review synthesised project' : 'Edit Project'}</h3>
          <div className="mb-6 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-dark-200">
            {synthesizedDraft
              ? <>Review the synthesised fields below — every field is editable. The project is <b>not saved yet</b>; click Save to commit. The compliance scrubber stripped any forbidden vocabulary (&ldquo;tokenisation&rdquo;, &ldquo;guaranteed yield&rdquo;, etc.) from the synthesis; if you typed those in the interview they&apos;ll appear as <span className="text-amber-400">[redacted]</span> for you to rewrite.</>
              : <>Manually edit any field below. Or close and click <span className="text-corp-green-400 font-medium">Auto-fill from KB</span> in the project&apos;s Knowledge Base section to regenerate fields from the source documents.</>}
          </div>

          {/* === ESSENTIALS — the 5 fields that drive everything downstream.
              Bigger labels, brighter text, dedicated bordered panel so the
              operator can't miss them. Funding Type leads because it's the
              single most predictive filter for both discovery + scoring. */}
          <div className="mb-6 p-5 rounded-xl bg-corp-green-500/5 border-2 border-corp-green-500/40">
            <div className="flex items-baseline justify-between mb-4">
              <h4 className="text-base text-corp-green-400 font-semibold uppercase tracking-wide">Essentials</h4>
              <span className="text-xs text-dark-300">These five fields drive every discovery + scoring + outreach decision.</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="block text-base text-white font-semibold mb-2">
                  Funding Type <span className="text-corp-green-400">*</span>
                  <span className="text-sm text-dark-300 font-normal ml-2">— what kind of capital are you raising?</span>
                </label>
                <select
                  value={form.funding_type || ''}
                  onChange={(e) => {
                    // Funding type pick → also auto-update partner_types
                    // so the project's "who-we're-reaching" tag matches
                    // the raise. Operator can still override via the
                    // dropdown below. Prevents the "funding_type=seed but
                    // partner_types still 'lender' from a previous default"
                    // inconsistency that bit LingoPure today.
                    const newType = (e.target.value || null) as FundingType | null;
                    setForm({
                      ...form,
                      funding_type: newType,
                      partner_types: partnerTypeForFundingType(newType),
                    });
                  }}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                >
                  <option value="">— Select the funding scenario —</option>
                  {FUNDING_TYPE_GROUPS.map(group => (
                    <optgroup key={group.category} label={group.category}>
                      {group.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-sm text-dark-300 mt-2">
                  Discovery looks for the matching investor profile; the scorer rejects mismatches as out_of_scope. Picking the right value here is the difference between a list of real prospects and a list of irrelevant VCs.
                </p>
              </div>

              {/* Partner Type — auto-derived from Funding Type above
                  (equity → investor, debt → lender, grants → funder).
                  Operator can override here when the default doesn't
                  fit (e.g. a Series B exit-focused raise where "buyer"
                  is more accurate than "investor"). */}
              <div className="md:col-span-2">
                <label className="block text-base text-white font-semibold mb-2">
                  Who you&apos;re reaching
                  <span className="text-sm text-dark-300 font-normal ml-2">— defaults from funding type, override if needed</span>
                </label>
                <select
                  value={form.partner_types || 'investor'}
                  onChange={(e) => setForm({ ...form, partner_types: e.target.value })}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                >
                  {PARTNER_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} title={opt.describe}>
                      {opt.label} — {opt.describe}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-dark-300 mt-2">
                  Drives the noun used in field labels (&quot;Investor Outcomes&quot; vs &quot;Lender Outcomes&quot;) and the framing used in outreach drafts. Auto-set from funding type when you change it above; override here if the default isn&apos;t right for your raise.
                </p>
              </div>

              <div>
                <label className="block text-base text-white font-semibold mb-2">
                  Project Name <span className="text-corp-green-400">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                  placeholder="e.g. Branscombe Estate — Senior Construction Debt"
                  required
                />
              </div>

              <div>
                <label className="block text-base text-white font-semibold mb-2">Sponsor</label>
                <input
                  value={form.sponsor}
                  onChange={(e) => setForm({ ...form, sponsor: e.target.value })}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                  placeholder="e.g. F2K Capital"
                />
              </div>

              <div>
                <label className="block text-base text-white font-semibold mb-2">Funding Target</label>
                <input
                  value={form.funding_target || ''}
                  onChange={(e) => setForm({ ...form, funding_target: e.target.value })}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                  placeholder="e.g. $16.2M @ 8.5%, ~22mo"
                />
              </div>

              <div>
                <label className="block text-base text-white font-semibold mb-2">Geography</label>
                <input
                  value={form.geography || ''}
                  onChange={(e) => setForm({ ...form, geography: e.target.value })}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none"
                  placeholder="e.g. Claremont, Tasmania"
                />
              </div>

              {/* DESCRIPTION lives in Essentials, not down with the
                  optional fields, because Generate Rubric AND Generate
                  Sequence both refuse to run without it. Burying it
                  was the cause of the "no description yet" deadlock
                  the operator hit on LingoPure Seed (2026-05-17). */}
              <div className="md:col-span-2">
                <label className="block text-base text-white font-semibold mb-2">
                  Description / Investment thesis <span className="text-corp-green-400">*</span>
                  <span className="text-sm text-dark-300 font-normal ml-2">— one paragraph, what's being funded + why an investor cares</span>
                </label>
                <textarea
                  value={form.description || ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  className="w-full bg-dark-800 border-2 border-dark-600 rounded-lg px-4 py-3 text-base text-white focus:border-corp-green-500 focus:outline-none resize-y"
                  placeholder="e.g. F2K Capital is raising $18.7M senior debt across two AU property development projects (Branscombe Estate TAS + Seafields Estate WA). First-mortgage, wholesale, fixed-term. Indicative 8-8.5% p.a., ~22mo. Anchor offtake to Homes Tasmania on the Branscombe facility."
                />
                <p className="text-sm text-dark-300 mt-2">
                  Required before Step 1 (Generate scoring rubric) and Step 2 (Generate sequence) will run. Auto-fill from KB populates this from your uploaded docs — but a manual one-paragraph version always works.
                </p>
              </div>
            </div>
          </div>

          {/* === SECONDARY — fields used by the renderer + sequence generator
              but not surfaced as visibly. Same field set as before, just
              demoted below the Essentials panel. */}
          <div className="mb-3 text-sm text-dark-400 uppercase tracking-wide font-medium">Additional detail</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-dark-300 mb-1">Asset Class</label>
              <input
                value={form.asset_class || ''}
                onChange={(e) => setForm({ ...form, asset_class: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="e.g. Residential modular construction (37 dwellings)"
              />
            </div>
          </div>

          {/* Compliance ruleset — per-project, picked from the four
              built-in presets in src/lib/compliance/rules.ts. Inherited
              by every sequence template generated for this project. */}
          <div className="mb-6">
            <label className="block text-sm text-dark-300 mb-1">
              Compliance ruleset <span className="text-dark-600">— applied to every message sent for this project</span>
            </label>
            <select
              value={form.compliance_mode || 'standard'}
              onChange={(e) => setForm({ ...form, compliance_mode: e.target.value })}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
            >
              <option value="standard">Standard — light-touch (blocks &ldquo;guarantee&rdquo; / &ldquo;risk-free&rdquo;). Default for new projects.</option>
              <option value="finance_au_senior_debt">Finance AU — Senior debt (strict; blocks tokenisation / yield language, $-figures must be approved set)</option>
              <option value="finance_au_wholesale">Finance AU — Wholesale junior debt (same rules as senior_debt, reserved)</option>
              <option value="finance_us">Finance US — standard + future Reg D rules (reserved)</option>
            </select>
            <p className="text-xs text-dark-500 mt-1">Pick the ruleset matching this project&apos;s regulatory domain. LingoPure EdTech → Standard. F2K Australian credit → Finance AU Senior debt. Inherited by every sequence template generated for this project.</p>
          </div>

          {/* Courtesy-contract attachments — surfaced in outreach as the
              value-offer link. Saves the recipient asking. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            <div>
              <label className="block text-sm text-dark-300 mb-1">
                Pitch deck URL <span className="text-dark-600">— sent in cold outreach</span>
              </label>
              <input
                type="url"
                value={form.pitch_deck_url || ''}
                onChange={(e) => setForm({ ...form, pitch_deck_url: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="https://docsend.com/view/... or Notion / Drive URL"
              />
              <p className="text-xs text-dark-500 mt-1">Surfaced directly in cold emails so investors can self-serve. Beats &ldquo;reply and I&apos;ll send the deck&rdquo; — they don&apos;t want to reply yet.</p>
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">
                One-pager URL <span className="text-dark-600">— lighter-weight alternative</span>
              </label>
              <input
                type="url"
                value={form.one_pager_url || ''}
                onChange={(e) => setForm({ ...form, one_pager_url: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="https://... — Notion page / PDF link"
              />
              <p className="text-xs text-dark-500 mt-1">Used in shorter messages (LinkedIn DMs) where the full deck is too much. Either alone or as the lead-in to the deck.</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={loading || !form.name.trim()} className="btn-primary disabled:opacity-50">
              {loading ? 'Saving…' : editingId ? 'Save Changes' : 'Create Project'}
            </button>
            <button type="button" onClick={cancelForm} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {projects.length > 0 ? (
        <div className="space-y-3">
          {projects.map((p) => (
            <div key={p.id} id={`project-${p.id}`} className="card-hover scroll-mt-6">
              <button
                onClick={() => setExpandedProject(expandedProject === p.id ? null : p.id)}
                className="flex items-center gap-3 w-full text-left"
              >
                <Briefcase className="w-5 h-5 text-corp-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="truncate">{p.name}</h4>
                    {p.is_active ? <span className="badge-green">Active</span> : <span className="badge-amber">Inactive</span>}
                    {p.funding_type && <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded bg-corp-green-500/15 text-corp-green-300 border border-corp-green-500/30 font-medium">{FUNDING_TYPE_GROUPS.flatMap(g => g.options).find(o => o.value === p.funding_type)?.label || p.funding_type}</span>}
                  </div>
                  <p className="text-dark-400 text-sm truncate">
                    {p.sponsor ? `${p.sponsor} · ` : ''}{p.description || 'No description yet — upload docs and Auto-fill from KB'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.funding_target && <span className="text-dark-600 text-xs hidden lg:inline">{p.funding_target.slice(0, 30)}</span>}
                  <PoolStatChip kind="project" ownerId={p.id} ownerName={p.name} />
                  {expandedProject === p.id ? <ChevronDown className="w-4 h-4 text-dark-500" /> : <ChevronRight className="w-4 h-4 text-dark-500" />}
                </div>
              </button>

              {expandedProject === p.id && (
                <div className="mt-4 pt-4 border-t border-dark-800">
                  {/* Project core attributes */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                    {[
                      { label: 'Funding Type', value: p.funding_type ? FUNDING_TYPE_GROUPS.flatMap(g => g.options).find(o => o.value === p.funding_type)?.label || p.funding_type : null },
                      { label: 'Sponsor', value: p.sponsor },
                      { label: 'Funding Target', value: p.funding_target },
                      { label: 'Geography', value: p.geography },
                      { label: 'Asset Class', value: p.asset_class },
                    ].filter(f => f.value).map(f => (
                      <div key={f.label}>
                        <span className="text-dark-200 text-sm uppercase tracking-wide font-semibold">{f.label}</span>
                        <p className="text-white text-base mt-1">{f.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ICP fields — labels adapt to the project's funding_type
                      (equity rounds show "Investor X", debt projects show
                      "Lender X"). Labels alone don't change the saved
                      values — those come from auto-fill, which now also
                      adapts perspective per funding_type. */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
                    {detailFieldsFor(p.funding_type)
                      .map(f => ({ label: f.label, value: p[f.key] }))
                      .filter(f => f.value)
                      .map(f => (
                        <div key={f.label}>
                          <span className="text-dark-200 text-sm font-semibold">{f.label}</span>
                          <p className="text-white text-base mt-1">{String(f.value)}</p>
                        </div>
                      ))}
                  </div>

                  {/* ───────────────────────────────────────────────────────────
                       Setup flow — top-to-bottom in the order needed.
                       0 → upload investment materials
                       1 → generate investor scoring rubric
                       2 → generate investor outreach sequence
                       3 → Find Investors (gated on rubric) */}

                  {/* Step 0: Knowledge Base (investment materials) */}
                  <div className="mb-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold">0</span>
                      <p className="text-sm font-medium text-purple-300">Investment materials — upload first</p>
                    </div>
                    <p className="text-dark-200 text-sm mt-1 mb-3 ml-7">
                      Upload pitch deck, financials, data room links, term sheets, market memo. Step 1 and 2 read from this — the more attached, the more accurately the AI describes the deal to investors.
                    </p>
                    <div className="ml-7">
                      <SourceManager projectId={p.id} />
                    </div>
                  </div>

                  {/* Step 1: Investor scoring rubric */}
                  <div className="mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">1</span>
                      <p className="text-sm font-medium text-amber-400">
                        Investor scoring rubric {(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? '— configured ✓' : '— not configured'}
                      </p>
                    </div>
                    <p className="text-dark-200 text-sm mt-1 mb-3 ml-7">
                      The rubric the discovery scorer uses to rank candidate investors 1–10 across capital fit, asset-class alignment, ticket band, track record and reachability. <strong className="text-amber-300">Required before Find Investors can run.</strong>
                    </p>
                    <div className="ml-7">
                      <GenerateRubricButton
                        projectId={p.id}
                        alreadyConfigured={!!(p as unknown as { scoring_rubric?: string | null }).scoring_rubric}
                        disabledReason={
                          !p.is_active
                            ? 'Activate this project first.'
                            : !p.description && !(p as unknown as { investment_thesis?: string | null }).investment_thesis
                              ? 'This project has no description or investment thesis yet — add one before generating a rubric.'
                              : null
                        }
                        disabledFixHref="/projects"
                        disabledFixLabel="Edit project"
                        onSuccess={() => loadProjects()}
                      />
                    </div>
                  </div>

                  {/* Step 2: Investor outreach sequence */}
                  <div className="mb-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold">2</span>
                      <p className="text-sm font-medium text-blue-400">Investor outreach sequence</p>
                    </div>
                    <p className="text-dark-200 text-sm mt-1 mb-3 ml-7">
                      Generate a 6-step LinkedIn + email sequence in credit-conversation / IC-meeting tone (not sales pitch). Tailored to this project&apos;s deal structure and investor audience.
                    </p>
                    <div className="ml-7">
                      <GenerateSequenceButton
                        projectId={p.id}
                        variant="secondary"
                        label="Generate / regenerate investor sequence"
                        confirmBeforeRun
                        disabledReason={
                          !p.is_active
                            ? 'Activate this project first.'
                            : !p.description && !(p as unknown as { investment_thesis?: string | null }).investment_thesis
                              ? 'This project has no description or investment thesis yet — add one before generating the sequence.'
                              : null
                        }
                        disabledFixHref="/projects"
                        disabledFixLabel="Edit project"
                        onSuccess={() => loadProjects()}
                      />
                    </div>
                  </div>

                  {/* Step 3: Find Investors — green block, gated on rubric */}
                  <div className={`mb-4 p-3 rounded-lg border ${(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? 'bg-corp-green-500/5 border-corp-green-500/20' : 'bg-dark-900/50 border-dark-700'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? 'bg-corp-green-500/20 text-corp-green-400' : 'bg-dark-700 text-dark-500'}`}>3</span>
                          <p className={`text-sm font-medium ${(p as unknown as { scoring_rubric?: string | null }).scoring_rubric ? 'text-corp-green-400' : 'text-dark-400'}`}>Find investors for this project</p>
                        </div>
                        <p className="text-dark-200 text-sm mt-1 ml-7">
                          {(p as unknown as { scoring_rubric?: string | null }).scoring_rubric
                            ? 'Generates targeted queries from the Knowledge Base, runs them across selected sources. Tier-prioritised: your 1st-degree connections surface first.'
                            : 'Complete Step 1 above (generate the investor scoring rubric) to unlock discovery.'}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                          {([
                            { key: 'sales_nav' as const, label: 'Sales Nav' },
                            { key: 'linkedin' as const, label: 'LinkedIn' },
                            { key: 'brave' as const, label: 'Brave' },
                          ]).map(s => (
                            <button
                              key={s.key}
                              type="button"
                              onClick={() => toggleFindSource(s.key)}
                              disabled={findingFor !== null}
                              className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium transition-colors ${
                                findSources.includes(s.key)
                                  ? 'bg-corp-green-500/20 text-corp-green-400 border border-corp-green-500/40'
                                  : 'bg-dark-800 text-dark-500 border border-dark-700 hover:text-dark-300'
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); findInvestorsForProject(p.id); }}
                        disabled={findingFor !== null || !p.is_active || !(p as unknown as { scoring_rubric?: string | null }).scoring_rubric}
                        className="btn-primary text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          !p.is_active
                            ? 'Activate this project first'
                            : !(p as unknown as { scoring_rubric?: string | null }).scoring_rubric
                              ? 'Generate the investor scoring rubric (Step 1) before running discovery'
                              : 'Run investor discovery batch'
                        }
                      >
                        {findingFor === p.id ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Finding…</>
                        ) : (
                          <><Target className="w-4 h-4" /> Find Investors</>
                        )}
                      </button>
                    </div>

                    {findResult && findResult.projectId === p.id && (
                      <div className="mt-3 pt-3 border-t border-corp-green-500/20 space-y-2">
                        {findResult.error ? (
                          <p className="text-red-400 text-xs">{findResult.error}</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                              <div className="bg-dark-900 rounded px-2 py-1.5">
                                <p className="text-dark-500">Queries</p>
                                <p className="font-mono font-bold">{findResult.queries_used.length}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Raw candidates returned by Unipile + Brave before de-dupe">
                                <p className="text-dark-500">Found</p>
                                <p className="font-mono font-bold">{findResult.candidates_found}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Unique candidates after de-dupe — these go to Claude scoring">
                                <p className="text-dark-500">Unique</p>
                                <p className="font-mono font-bold">{findResult.candidates_unique}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Reached the Prospects list (passed scoring, has a real contact + email)">
                                <p className="text-dark-500">Kept</p>
                                <p className="font-mono font-bold text-corp-green-400">{findResult.candidates_scored}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Scored but dropped: out-of-scope OR no email OR no real contact name. Strict 2-bucket rule — Prospects only keeps contactable rows.">
                                <p className="text-dark-500">Discarded</p>
                                <p className="font-mono font-bold text-dark-300">{findResult.candidates_discarded}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5" title="Candidates whose Claude scoring call errored — hidden bug surface">
                                <p className="text-dark-500">Failed</p>
                                <p className={`font-mono font-bold ${findResult.candidates_failed > 0 ? 'text-red-400' : ''}`}>{findResult.candidates_failed}</p>
                              </div>
                              <div className="bg-dark-900 rounded px-2 py-1.5">
                                <p className="text-dark-500">Top fit</p>
                                <p className="font-mono font-bold">
                                  {findResult.top_results[0]?.weighted_score?.toFixed(1) ?? '—'}
                                </p>
                              </div>
                            </div>
                            {findResult.tier_breakdown && (
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-corp-green-500/10 border border-corp-green-500/20 rounded px-2 py-1.5">
                                  <p className="text-corp-green-400 text-[10px] uppercase tracking-wide">1st</p>
                                  <p className="font-mono font-bold text-corp-green-400">{findResult.tier_breakdown['1st'] || 0}</p>
                                </div>
                                <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1.5">
                                  <p className="text-blue-400 text-[10px] uppercase tracking-wide">2nd</p>
                                  <p className="font-mono font-bold text-blue-400">{findResult.tier_breakdown['2nd'] || 0}</p>
                                </div>
                                <div className="bg-dark-700/40 border border-dark-700 rounded px-2 py-1.5">
                                  <p className="text-dark-400 text-[10px] uppercase tracking-wide">Cold</p>
                                  <p className="font-mono font-bold text-dark-300">{findResult.tier_breakdown.cold || 0}</p>
                                </div>
                              </div>
                            )}
                            {findResult.top_results.length > 0 && (
                              <Link href="/partners" className="block text-xs text-corp-green-400 hover:text-corp-green-300 underline">
                                View {findResult.top_results.length} top-scored prospects in Prospects →
                              </Link>
                            )}
                            {findResult.queries_used.length > 0 && (
                              <details className="text-xs">
                                <summary className="text-dark-500 cursor-pointer hover:text-dark-300">
                                  Queries used ({findResult.queries_used.length})
                                </summary>
                                <ul className="mt-2 space-y-1 text-dark-400">
                                  {findResult.queries_used.map((q, i) => (
                                    <li key={i} className="flex flex-col gap-0.5 pl-2 border-l border-dark-700">
                                      <code className="text-corp-green-300">{q.query}</code>
                                      <span className="text-dark-600 text-[10px]">
                                        {q.intended_source && <span className="text-blue-400">[{q.intended_source}] </span>}
                                        {q.category} — {q.rationale}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {findResult.search_errors && findResult.search_errors.length > 0 && (
                              <details className="text-xs" open={findResult.candidates_scored === 0}>
                                <summary className="text-red-400 cursor-pointer hover:text-red-300">
                                  ⚠ Search errors ({findResult.search_errors.length})
                                </summary>
                                <ul className="mt-2 space-y-1 text-red-300">
                                  {findResult.search_errors.map((e, i) => (
                                    <li key={i} className="flex flex-col gap-0.5 pl-2 border-l border-red-500/30">
                                      <span className="font-mono text-[10px] text-red-400">{e.source} / {e.tier} — {e.query}</span>
                                      <code className="text-red-300 text-[10px] break-all">{e.error}</code>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {findResult.scoring_errors && findResult.scoring_errors.length > 0 && (
                              <details className="text-xs" open={findResult.candidates_failed > 0}>
                                <summary className="text-red-400 cursor-pointer hover:text-red-300">
                                  ⚠ Scoring errors — {findResult.candidates_failed} candidates failed Claude scoring ({findResult.scoring_errors.length} unique error{findResult.scoring_errors.length === 1 ? '' : 's'})
                                </summary>
                                <ul className="mt-2 space-y-1 text-red-300">
                                  {findResult.scoring_errors.map((e, i) => (
                                    <li key={i} className="pl-2 border-l border-red-500/30">
                                      <code className="text-red-300 text-[10px] break-all">{e}</code>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-4 mb-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                      className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-white"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(p); }}
                      className={`flex items-center gap-1.5 text-sm ${p.is_active ? 'text-dark-400 hover:text-amber-400' : 'text-dark-400 hover:text-corp-green-400'}`}
                    >
                      {p.is_active ? (<><PowerOff className="w-3.5 h-3.5" /> Mark Inactive</>) : (<><Power className="w-3.5 h-3.5" /> Mark Active</>)}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                      className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>

                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-16">
          <Briefcase className="w-12 h-12 text-dark-600 mx-auto mb-4" />
          <p className="text-dark-400">No projects yet.</p>
          <p className="text-dark-500 text-sm mt-1">Add your first project to start discovering lenders.</p>
        </div>
      )}
    </div>
  );
}
