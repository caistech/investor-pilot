-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organisations table (multi-tenant support)
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  full_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  one_sentence_description TEXT,
  core_mechanism TEXT,
  customer_outcomes TEXT,
  icp_company_size TEXT,
  icp_stage TEXT,
  icp_verticals TEXT,
  icp_buyer_title TEXT,
  icp_user_title TEXT,
  icp_stack_tools TEXT,
  traction_arr TEXT,
  traction_customers TEXT,
  traction_logos TEXT,
  partner_types TEXT DEFAULT 'referral',
  exclusions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partners table (the CRM)
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  domain TEXT,
  logo_url TEXT,
  partner_type TEXT CHECK (partner_type IN ('referral', 'integration', 'reseller', 'combination')),
  category TEXT,
  status TEXT DEFAULT 'scored' CHECK (status IN (
    'scored', 'contact_found', 'contact_partial', 'angle_defined',
    'draft_ready', 'sent', 'replied', 'follow_up_due',
    'meeting_booked', 'qualified', 'active_partner_discussion',
    'disqualified', 'closed_won', 'closed_lost'
  )),
  weighted_score NUMERIC(4,2),
  confidence_score TEXT CHECK (confidence_score IN ('normal', 'low-confidence')),
  audience_overlap_score INTEGER,
  complementarity_score INTEGER,
  partner_readiness_score INTEGER,
  reachability_score INTEGER,
  strategic_leverage_score INTEGER,
  audience_overlap_notes TEXT,
  complementarity_notes TEXT,
  partner_readiness_notes TEXT,
  reachability_notes TEXT,
  strategic_leverage_notes TEXT,
  contact_name TEXT,
  contact_title TEXT,
  contact_email TEXT,
  contact_linkedin TEXT,
  email_confidence INTEGER,
  email_status TEXT CHECK (email_status IN ('verified', 'probable', 'company_level', 'unresolved')),
  contact_source TEXT,
  selected_gtm_angle TEXT,
  partnership_motion TEXT,
  draft_status TEXT DEFAULT 'none' CHECK (draft_status IN ('none', 'created', 'approved', 'filed')),
  draft_subject TEXT,
  draft_body TEXT,
  gmail_draft_id TEXT,
  hunter_lead_id INTEGER,
  hunter_sequence_id INTEGER,
  hunter_sending_status TEXT,
  screened_out BOOLEAN DEFAULT FALSE,
  screened_out_reason TEXT,
  last_session_notes TEXT,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent sessions table
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  mode TEXT CHECK (mode IN ('guided', 'batch')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  current_stage TEXT,
  partners_added INTEGER DEFAULT 0,
  partners_updated INTEGER DEFAULT 0,
  contacts_found INTEGER DEFAULT 0,
  drafts_filed INTEGER DEFAULT 0,
  hunter_leads_pushed INTEGER DEFAULT 0,
  session_log JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id)
);

-- Session events table
CREATE TABLE session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own organisation" ON organisations FOR SELECT
  USING (owner_id = auth.uid() OR id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their own profile" ON profiles FOR ALL USING (id = auth.uid());

CREATE POLICY "Org members can view products" ON products FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can manage products" ON products FOR ALL
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can view partners" ON partners FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can manage partners" ON partners FOR ALL
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can view sessions" ON agent_sessions FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can manage sessions" ON agent_sessions FOR ALL
  USING (organisation_id IN (SELECT organisation_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can view session events" ON session_events FOR SELECT
  USING (session_id IN (SELECT id FROM agent_sessions WHERE organisation_id IN (
    SELECT organisation_id FROM profiles WHERE id = auth.uid())));

-- Indexes
CREATE INDEX idx_partners_org_status ON partners(organisation_id, status);
CREATE INDEX idx_partners_domain ON partners(domain);
CREATE INDEX idx_session_events_session ON session_events(session_id, created_at);
CREATE INDEX idx_agent_sessions_org ON agent_sessions(organisation_id, status);

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER update_organisations_updated_at BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_partners_updated_at BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION update_updated_at();
