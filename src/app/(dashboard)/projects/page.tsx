'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, Briefcase, Sparkles, Loader2, ChevronDown, ChevronRight, Pencil, Trash2, Power, PowerOff, Target } from 'lucide-react';
import Link from 'next/link';
import type { Project, ProjectType } from '@/lib/types';
import SourceManager from '@/components/products/source-manager';
import { GenerateRubricButton } from '@/components/products/generate-rubric-button';
import { GenerateSequenceButton } from '@/components/settings/generate-sequence-button';

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  senior_debt: 'Senior debt',
  mezzanine: 'Mezzanine',
  equity: 'Equity',
  platform_equity: 'Platform equity',
  mixed: 'Mixed',
};

const DETAIL_FIELDS: Array<{ key: keyof Project; label: string }> = [
  { key: 'core_mechanism', label: 'Core Mechanism (lender perspective)' },
  { key: 'customer_outcomes', label: 'Lender Outcomes' },
  { key: 'icp_company_size', label: 'Lender Company Size' },
  { key: 'icp_stage', label: 'Lender Stage / Maturity' },
  { key: 'icp_verticals', label: 'Lender Verticals' },
  { key: 'icp_buyer_title', label: 'Buyer Title at Lender Firm' },
  { key: 'icp_user_title', label: 'User Title at Lender Firm' },
  { key: 'icp_stack_tools', label: 'Lender Stack Tools' },
  { key: 'traction_arr', label: 'Proof Points' },
  { key: 'traction_customers', label: 'Existing Participants' },
  { key: 'partner_types', label: 'Partner Type' },
  { key: 'exclusions', label: 'Exclusions' },
];

const EMPTY_FORM: Omit<Project, 'id' | 'organisation_id' | 'created_at' | 'updated_at'> = {
  sponsor: '',
  name: '',
  description: '',
  project_type: null,
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
      .select('organisation_id')
      .eq('id', user.id)
      .single();
    return profile?.organisation_id || null;
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
      loadProjects();
    }
    setLoading(false);
  }

  function startEdit(project: Project) {
    setForm({
      sponsor: project.sponsor || '',
      name: project.name,
      description: project.description || '',
      project_type: project.project_type,
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
    const { data, error: insertError } = await supabase
      .from('projects')
      .insert({ organisation_id: orgId, name: placeholderName })
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
    setShowForm(false);
    setDraftProjectId(null);
    setDraftProjectName('');
    loadProjects();
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
        <button onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Project
        </button>
      </div>

      {showForm && !editingId && (
        <div className="card mb-8">
          <h3 className="mb-4">New Project</h3>

          {!draftProjectId ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-corp-green-500/5 border border-corp-green-500/20 text-xs text-dark-300">
                <p className="font-medium text-corp-green-400 mb-1">KB-first project creation</p>
                <p className="text-dark-400">
                  Upload your Investment Memorandum, Finance Submission, term sheet PDFs (and add URLs / pasted text if you have any) directly here. The AI extracts the sponsor, funding terms, geography, asset class, lender ICP — everything — from those sources. No form to fill manually.
                </p>
              </div>

              <div>
                <label className="block text-sm text-dark-300 mb-1">Project Name <span className="text-dark-600">(optional — AI will extract if blank)</span></label>
                <input
                  value={draftProjectName}
                  onChange={(e) => setDraftProjectName(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                  placeholder="e.g. Branscombe Estate — Senior Construction Debt"
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={createDraftProject}
                  disabled={loading}
                  className="btn-primary disabled:opacity-50"
                >
                  {loading ? 'Creating…' : 'Next: Upload sources →'}
                </button>
                <button onClick={cancelForm} className="btn-secondary">Cancel</button>
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

      {showForm && editingId && (
        <form onSubmit={handleSave} className="card mb-8">
          <h3 className="mb-4">Edit Project</h3>
          <div className="mb-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-dark-300">
            <p className="text-dark-400">Manually edit any field below. Or close and click <span className="text-corp-green-400">Auto-fill from KB</span> in the project&apos;s Knowledge Base section to regenerate fields from the source documents.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-dark-300 mb-1">Project Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="e.g. Branscombe Estate — Senior Construction Debt"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">Sponsor</label>
              <input
                value={form.sponsor}
                onChange={(e) => setForm({ ...form, sponsor: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="e.g. F2K Capital"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">Project Type</label>
              <select
                value={form.project_type || ''}
                onChange={(e) => setForm({ ...form, project_type: (e.target.value || null) as ProjectType | null })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map(k => (
                  <option key={k} value={k}>{PROJECT_TYPE_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">Funding Target</label>
              <input
                value={form.funding_target || ''}
                onChange={(e) => setForm({ ...form, funding_target: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="e.g. $16.2M @ 8.5% indicative, first-mortgage, ~22mo"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-300 mb-1">Geography</label>
              <input
                value={form.geography || ''}
                onChange={(e) => setForm({ ...form, geography: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none"
                placeholder="e.g. Claremont, Tasmania"
              />
            </div>
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

          <div className="mb-6">
            <label className="block text-sm text-dark-300 mb-1">Description <span className="text-dark-600">(pitch to the lender)</span></label>
            <textarea
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:border-corp-green-500 focus:outline-none resize-y"
              placeholder="One-paragraph pitch describing what's being funded, terms, security, and structure — from the lender's perspective."
            />
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
            <div key={p.id} className="card-hover">
              <button
                onClick={() => setExpandedProject(expandedProject === p.id ? null : p.id)}
                className="flex items-center gap-3 w-full text-left"
              >
                <Briefcase className="w-5 h-5 text-corp-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="truncate">{p.name}</h4>
                    {p.is_active ? <span className="badge-green">Active</span> : <span className="badge-amber">Inactive</span>}
                    {p.project_type && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-dark-700 text-dark-300">{PROJECT_TYPE_LABELS[p.project_type]}</span>}
                  </div>
                  <p className="text-dark-400 text-sm truncate">
                    {p.sponsor ? `${p.sponsor} · ` : ''}{p.description || 'No description yet — upload docs and Auto-fill from KB'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.funding_target && <span className="text-dark-600 text-xs hidden md:inline">{p.funding_target.slice(0, 30)}</span>}
                  <Link
                    href={`/projects/${p.id}/pool`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 hidden md:inline"
                    title="Open the auto-generated Investor Pool Profile for this project"
                  >
                    Pool profile →
                  </Link>
                  {expandedProject === p.id ? <ChevronDown className="w-4 h-4 text-dark-500" /> : <ChevronRight className="w-4 h-4 text-dark-500" />}
                </div>
              </button>

              {expandedProject === p.id && (
                <div className="mt-4 pt-4 border-t border-dark-800">
                  {/* Project core attributes */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                    {[
                      { label: 'Sponsor', value: p.sponsor },
                      { label: 'Type', value: p.project_type ? PROJECT_TYPE_LABELS[p.project_type] : null },
                      { label: 'Funding Target', value: p.funding_target },
                      { label: 'Geography', value: p.geography },
                      { label: 'Asset Class', value: p.asset_class },
                    ].filter(f => f.value).map(f => (
                      <div key={f.label}>
                        <span className="text-dark-600 text-xs uppercase tracking-wide">{f.label}</span>
                        <p className="text-dark-300">{f.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ICP fields */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
                    {DETAIL_FIELDS
                      .map(f => ({ label: f.label, value: p[f.key] }))
                      .filter(f => f.value)
                      .map(f => (
                        <div key={f.label}>
                          <span className="text-dark-600 text-xs">{f.label}</span>
                          <p className="text-dark-300">{String(f.value)}</p>
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
                    <p className="text-dark-500 text-xs mt-0.5 mb-3 ml-7">
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
                    <p className="text-dark-500 text-xs mt-0.5 mb-3 ml-7">
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
                    <p className="text-dark-500 text-xs mt-0.5 mb-3 ml-7">
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
                        <p className="text-dark-500 text-xs mt-0.5 ml-7">
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
                            <div className="grid grid-cols-3 gap-2 text-xs">
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
                              <div className="bg-dark-900 rounded px-2 py-1.5">
                                <p className="text-dark-500">Scored</p>
                                <p className="font-mono font-bold text-corp-green-400">{findResult.candidates_scored}</p>
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
