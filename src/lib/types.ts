export type PartnerStatus =
  | 'scored' | 'contact_found' | 'contact_partial' | 'angle_defined'
  | 'draft_ready' | 'sent' | 'replied' | 'follow_up_due'
  | 'meeting_booked' | 'qualified' | 'active_partner_discussion'
  | 'disqualified' | 'closed_won' | 'closed_lost';

export type PartnerType = 'referral' | 'integration' | 'reseller' | 'combination' | 'lender' | 'buyer';
export type EmailStatus = 'verified' | 'probable' | 'company_level' | 'unresolved';
export type ConfidenceScore = 'normal' | 'low-confidence';
export type DraftStatus = 'none' | 'created' | 'approved' | 'filed';
export type SessionMode = 'guided' | 'batch';
export type SessionStatus = 'active' | 'completed' | 'paused';
export type UserRole = 'owner' | 'admin' | 'member';

export type PipelineStage =
  | 'initialise' | 'categories' | 'search' | 'screen'
  | 'score' | 'browse' | 'find_contact' | 'enrich_email'
  | 'select_motion' | 'draft' | 'file_gmail' | 'hunter_push';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  organisation_id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  organisation_id: string;
  name: string;
  one_sentence_description: string | null;
  core_mechanism: string | null;
  customer_outcomes: string | null;
  icp_company_size: string | null;
  icp_stage: string | null;
  icp_verticals: string | null;
  icp_buyer_title: string | null;
  icp_user_title: string | null;
  icp_stack_tools: string | null;
  traction_arr: string | null;
  traction_customers: string | null;
  traction_logos: string | null;
  partner_types: string;
  exclusions: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * @deprecated since migration 027 — superseded by the more granular
 * FundingType. Retained on the schema + interface so legacy data + prompt
 * code keep compiling, but no longer surfaced in the operator UI. New
 * projects land with funding_type set instead; project_type is no longer
 * auto-extracted or editable.
 */
export type ProjectType = 'senior_debt' | 'mezzanine' | 'equity' | 'platform_equity' | 'mixed';

/**
 * Fine-grained funding scenario (migration 027). More predictive than
 * ProjectType for ICP filtering — a Series A LP won't write construction
 * loans, a real-estate debt fund won't fund pre-seed equity. Drives the
 * discovery prompt (narrows candidate type before scoring) AND the ICP
 * rubric (penalises mismatched candidates after scoring). DB CHECK
 * constraint enforces this exact set — extending requires a new migration.
 */
export type FundingType =
  // Equity — startup / venture
  | 'pre_seed'
  | 'seed'
  | 'series_a'
  | 'series_b'
  | 'series_c_growth'
  | 'convertible_safe'
  | 'strategic_corporate_vc'
  // Debt — real estate / project finance
  | 'construction_debt_senior'
  | 'construction_debt_mezz'
  | 'land_acquisition_debt'
  | 'bridge_refinance'
  | 'development_equity_lp'
  // Debt — business / operating
  | 'senior_business_term_debt'
  | 'working_capital_line'
  | 'revenue_based_financing'
  | 'equipment_asset_financing'
  | 'acquisition_lbo'
  | 'invoice_factoring'
  // Alternative
  | 'grant_non_dilutive'
  | 'equity_crowdfunding'
  | 'pre_ipo_late_stage'
  | 'sponsor_capital_gp_commitment';

/**
 * UI-facing groupings + labels for the funding_type dropdown. Order is
 * deliberate — dropdown renders categories in this order, items appear in
 * the order shown here. Labels are operator-facing; values are persisted.
 * The "describe" field is used by the discovery / ICP prompts so the LLM
 * gets a sentence describing what kind of investor matches each type
 * (rather than guessing from the slug).
 */
export const FUNDING_TYPE_GROUPS: Array<{
  category: string;
  options: Array<{ value: FundingType; label: string; describe: string }>;
}> = [
  {
    category: 'Equity — startup / venture',
    options: [
      { value: 'pre_seed', label: 'Pre-seed', describe: 'Pre-seed equity ($100K–$1M typical, angel + micro-VC, no revenue or earliest traction)' },
      { value: 'seed', label: 'Seed', describe: 'Seed equity ($500K–$5M typical, seed funds + lead angels, early revenue or strong MVP)' },
      { value: 'series_a', label: 'Series A', describe: 'Series A equity ($5–$15M typical, institutional VC leads, $1M+ ARR or equivalent traction)' },
      { value: 'series_b', label: 'Series B', describe: 'Series B equity ($15–$40M typical, growth-stage VC, $5–$20M ARR, repeatable GTM)' },
      { value: 'series_c_growth', label: 'Series C / growth equity', describe: 'Series C / growth equity ($30M+, growth funds + late-stage crossover, scaled revenue)' },
      { value: 'convertible_safe', label: 'Convertible note / SAFE', describe: 'Convertible note or SAFE round — bridge or party-round angels and seed funds writing on standard YC SAFE / standard convertible terms' },
      { value: 'strategic_corporate_vc', label: 'Strategic / corporate VC', describe: 'Strategic or corporate VC capital — investors are operating companies in the same vertical seeking commercial synergy plus financial return' },
    ],
  },
  {
    category: 'Debt — real estate / project finance',
    options: [
      { value: 'construction_debt_senior', label: 'Construction debt (senior)', describe: 'Senior construction debt for property development — wholesale lenders, private credit funds, debt funds writing first-mortgage tickets ($1–$20M typical)' },
      { value: 'construction_debt_mezz', label: 'Construction debt (mezzanine / preferred equity)', describe: 'Mezzanine or preferred equity behind senior construction debt — higher-yield lenders, mezz funds, family offices taking second-charge or pref position' },
      { value: 'land_acquisition_debt', label: 'Land acquisition debt', describe: 'Land acquisition debt — short-tenor secured debt against land holding pre-development, typically from private credit / specialty lenders' },
      { value: 'bridge_refinance', label: 'Bridge / refinance', describe: 'Bridge financing or refinance of an existing facility — typically short-tenor, used to transition between project phases or take out an existing lender' },
      { value: 'development_equity_lp', label: 'Development equity (LP commitment)', describe: 'LP equity into a property development project — family offices, HNWI syndicates, real estate funds writing equity tickets into a single project SPV' },
    ],
  },
  {
    category: 'Debt — business / operating',
    options: [
      { value: 'senior_business_term_debt', label: 'Senior business term debt', describe: 'Senior business term debt — commercial banks, private credit, or specialty lenders writing term loans against the operating business cash flow' },
      { value: 'working_capital_line', label: 'Working capital / line of credit', describe: 'Working capital line — revolving credit facility for inventory, AR, or seasonal needs, from commercial banks or specialty lenders' },
      { value: 'revenue_based_financing', label: 'Revenue-based financing (RBF)', describe: 'Revenue-based financing — repayment as % of revenue, no equity dilution, from RBF specialty funds (Lighter, Pipe, Capchase-style)' },
      { value: 'equipment_asset_financing', label: 'Equipment / asset financing', describe: 'Equipment or asset financing — debt secured against specific equipment or assets, from equipment-finance specialists and asset-based lenders' },
      { value: 'acquisition_lbo', label: 'Acquisition financing / LBO', describe: 'Acquisition financing or leveraged buyout debt — senior + mezz stack for acquiring another business, from PE-debt funds and specialty acquisition lenders' },
      { value: 'invoice_factoring', label: 'Invoice factoring / supply chain', describe: 'Invoice factoring or supply chain finance — short-term advance against AR, from factoring companies and supply chain finance providers' },
    ],
  },
  {
    category: 'Alternative',
    options: [
      { value: 'grant_non_dilutive', label: 'Grant / non-dilutive', describe: 'Grant or non-dilutive funding — government programs, foundations, R&D grants, accelerators with no equity ask' },
      { value: 'equity_crowdfunding', label: 'Equity crowdfunding', describe: 'Equity crowdfunding — retail investors via regulated platforms (Birchal, Wefunder, Crowdcube, etc), typically $500K–$5M raises' },
      { value: 'pre_ipo_late_stage', label: 'Pre-IPO / late-stage growth', describe: 'Pre-IPO or late-stage growth equity — crossover funds, sovereign wealth, mutual funds writing very large cheques pre-listing' },
      { value: 'sponsor_capital_gp_commitment', label: 'Sponsor capital / GP commitment', describe: 'Sponsor capital or GP commitment — investors backing the fund sponsor / general partner rather than a specific project (LP into the fund itself)' },
    ],
  },
];

/** Flat lookup keyed by value — used to render labels and look up the
 * describe string inside discovery / ICP prompts. */
export const FUNDING_TYPE_BY_VALUE: Record<FundingType, { label: string; describe: string; category: string }> =
  FUNDING_TYPE_GROUPS.reduce((acc, group) => {
    for (const opt of group.options) {
      acc[opt.value] = { label: opt.label, describe: opt.describe, category: group.category };
    }
    return acc;
  }, {} as Record<FundingType, { label: string; describe: string; category: string }>);

/**
 * The labelled set of partner_types the operator can pick from on a
 * project. The free-text field was a footgun (the LLM was returning
 * "mortgage_broker" / arbitrary strings, and the DB CHECK on partners.
 * partner_type silently rejected anything outside its allowed set, losing
 * candidates). Now the project surface exposes the curated list and
 * downstream prompts can resolve against it deterministically.
 */
export const PARTNER_TYPE_OPTIONS: Array<{ value: string; label: string; describe: string }> = [
  { value: 'investor', label: 'Investor', describe: 'Equity capital provider — VC, family office, angel, strategic, growth fund' },
  { value: 'lender', label: 'Lender', describe: 'Debt capital provider — private credit, direct lender, senior debt fund, mezz fund' },
  { value: 'buyer', label: 'Buyer', describe: 'Acquirer or licensee — strategic, PE add-on, customer with M&A intent' },
  { value: 'client', label: 'Client', describe: 'Paying customer / pilot partner — usually for product sales, not capital raises' },
  { value: 'partner', label: 'Channel partner', describe: 'GTM or distribution partner — reseller, integration, referral, co-marketing' },
  { value: 'funder', label: 'Funder (other)', describe: 'Grant maker, foundation, sponsor — non-dilutive / non-debt capital' },
];

/**
 * Map funding_type → the default partner_types slug. Auto-derived when
 * the operator picks a funding type on the project form; they can still
 * override via the dropdown. Eliminates the "operator picks Seed but
 * partner_types is still 'lender' from a previous F2K-era default"
 * inconsistency that bit the LingoPure flow.
 */
export function partnerTypeForFundingType(fundingType: FundingType | null | undefined): string {
  if (!fundingType) return 'investor';
  const entry = FUNDING_TYPE_BY_VALUE[fundingType];
  if (!entry) return 'investor';
  // Debt categories → lender. Alternative-funder slugs like
  // grant_non_dilutive map to 'funder' (the dropdown's catch-all
  // for non-equity non-debt capital). Everything else → investor.
  if (entry.category.startsWith('Debt')) return 'lender';
  if (fundingType === 'grant_non_dilutive') return 'funder';
  return 'investor';
}

/**
 * The noun used to refer to the capital provider for a given funding type.
 * Drives field labels in the project UI, the perspective framing in the
 * auto-fill prompt, and the sequence generator tone.
 *
 *   Equity rounds            → "Investor"
 *   Real-estate debt         → "Lender"
 *   Business debt            → "Lender"
 *   Alternative              → "Investor" (most common) or generic
 *
 * Falls back to "Investor" when funding_type is null — equity is the
 * platform-wide default tone (was "Lender" before migration 027, when
 * the system assumed F2K debt fund only).
 */
export function capitalProviderTerm(fundingType: FundingType | null | undefined): {
  noun: 'Investor' | 'Lender' | 'Funder';
  nounUpper: 'INVESTOR' | 'LENDER' | 'FUNDER';
} {
  if (!fundingType) return { noun: 'Investor', nounUpper: 'INVESTOR' };
  const entry = FUNDING_TYPE_BY_VALUE[fundingType];
  if (!entry) return { noun: 'Investor', nounUpper: 'INVESTOR' };
  if (entry.category.startsWith('Debt')) return { noun: 'Lender', nounUpper: 'LENDER' };
  return { noun: 'Investor', nounUpper: 'INVESTOR' };
}

export interface Project {
  id: string;
  organisation_id: string;
  sponsor: string;             // F2K Capital
  name: string;                // Branscombe Estate
  description: string | null;  // What's being raised, for the lender
  project_type: ProjectType | null;
  // Migration 027 — fine-grained funding scenario. Drives discovery prompt
  // filtering + ICP scoring + sequence generator tone. See FundingType type
  // and FUNDING_TYPE_GROUPS for the canonical list.
  funding_type: FundingType | null;
  funding_target: string | null;   // "$16.2M @ 8.5% indicative, first-mortgage"
  geography: string | null;        // "Claremont, Tasmania"
  asset_class: string | null;      // "Residential modular construction"
  icp_buyer_title: string | null;
  icp_user_title: string | null;
  icp_company_size: string | null;
  icp_stage: string | null;
  icp_verticals: string | null;
  icp_stack_tools: string | null;
  customer_outcomes: string | null;
  core_mechanism: string | null;
  traction_arr: string | null;
  traction_customers: string | null;
  partner_types: string;
  exclusions: string | null;
  // Courtesy-contract attachments (migration 025). Surfaced directly in
  // cold outreach as the value-offer link — saves the recipient asking.
  pitch_deck_url: string | null;
  one_pager_url: string | null;
  // Pre-send compliance ruleset (migration 026). Inherited by every
  // sequence template generated for this project. Operator picks the
  // appropriate ruleset per project — F2K credit work needs strict
  // finance_au_senior_debt, LingoPure EdTech needs light-touch standard.
  compliance_mode: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Partner {
  id: string;
  organisation_id: string;
  product_id: string | null;
  // Set when the partner was discovered for a fundraising project rather
  // than a sales product (migration 007). Exactly one of (product_id,
  // project_id) should be non-null per partner; the draft route routes
  // off this column.
  project_id: string | null;
  company_name: string;
  domain: string | null;
  logo_url: string | null;
  partner_type: PartnerType | null;
  category: string | null;
  status: PartnerStatus;
  weighted_score: number | null;
  confidence_score: ConfidenceScore | null;
  audience_overlap_score: number | null;
  complementarity_score: number | null;
  partner_readiness_score: number | null;
  reachability_score: number | null;
  strategic_leverage_score: number | null;
  audience_overlap_notes: string | null;
  complementarity_notes: string | null;
  partner_readiness_notes: string | null;
  reachability_notes: string | null;
  strategic_leverage_notes: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  email_confidence: number | null;
  email_status: EmailStatus | null;
  contact_source: string | null;
  selected_gtm_angle: string | null;
  partnership_motion: string | null;
  draft_status: DraftStatus;
  draft_subject: string | null;
  draft_body: string | null;
  gmail_draft_id: string | null;
  hunter_lead_id: number | null;
  hunter_sequence_id: number | null;
  hunter_sending_status: string | null;
  screened_out: boolean;
  screened_out_reason: string | null;
  last_session_notes: string | null;
  network_distance: '1st' | '2nd' | 'cold' | null;
  source: 'linkedin' | 'sales_nav' | 'brave' | 'manual' | null;
  // Origin discovery run (migration 010). Null for legacy rows discovered
  // before run tracking was added. Resolves to discovery_runs.run_code +
  // created_at via the runsById map passed to PipelineTable.
  first_seen_in_run_id: string | null;
  // Most recent run that surfaced this partner (migration 015). Set on
  // every UPDATE in upsertPartner. Lets the Prospects "filter by run"
  // dropdown match re-discoveries — partner surfaces if EITHER first_seen
  // OR last_seen matches the chosen run.
  last_seen_in_run_id: string | null;
  // Engagement tracking (migration 024). Set when the prospect accepts
  // a value offer — pilot started, brief downloaded, positive reply.
  // Distinct from replied (any inbound) and meeting_booked
  // (post-conversation). Drives the Warm-engaged filter + warmer
  // follow-up cadence.
  engaged_at: string | null;
  engagement_type: string | null;
  engagement_note: string | null;
  last_updated_at: string;
  created_at: string;
}

export type SourceType = 'url' | 'file' | 'text';
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProductSource {
  id: string;
  product_id: string;
  organisation_id: string;
  source_type: SourceType;
  title: string;
  url: string | null;
  content: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  processing_status: ProcessingStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSession {
  id: string;
  organisation_id: string;
  product_id: string | null;
  mode: SessionMode | null;
  status: SessionStatus;
  current_stage: PipelineStage | null;
  partners_added: number;
  partners_updated: number;
  contacts_found: number;
  drafts_filed: number;
  hunter_leads_pushed: number;
  session_log: SessionEvent[];
  started_at: string;
  completed_at: string | null;
  created_by: string;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  partner_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

export interface StageResult {
  success: boolean;
  stage: PipelineStage;
  data: Record<string, unknown>;
  error?: string;
  events: Omit<SessionEvent, 'id' | 'session_id' | 'created_at'>[];
}

export const STATUS_COLORS: Record<PartnerStatus, string> = {
  scored: 'badge-grey',
  contact_found: 'badge-blue',
  contact_partial: 'badge-blue',
  angle_defined: 'badge-purple',
  draft_ready: 'badge-amber',
  sent: 'badge-orange',
  replied: 'badge-green',
  follow_up_due: 'badge-orange',
  meeting_booked: 'badge-green',
  qualified: 'badge-green',
  active_partner_discussion: 'badge-green',
  disqualified: 'badge-red',
  closed_won: 'badge-green',
  closed_lost: 'badge-red',
};
