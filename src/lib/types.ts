export type PartnerStatus =
  | 'scored' | 'contact_found' | 'contact_partial' | 'angle_defined'
  | 'draft_ready' | 'sent' | 'replied' | 'follow_up_due'
  | 'meeting_booked' | 'qualified' | 'active_partner_discussion'
  | 'disqualified' | 'closed_won' | 'closed_lost';

export type PartnerType = 'referral' | 'integration' | 'reseller' | 'combination';
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

export type ProjectType = 'senior_debt' | 'mezzanine' | 'equity' | 'platform_equity' | 'mixed';

export interface Project {
  id: string;
  organisation_id: string;
  sponsor: string;             // F2K Capital
  name: string;                // Branscombe Estate
  description: string | null;  // What's being raised, for the lender
  project_type: ProjectType | null;
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
