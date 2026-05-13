-- Migration 007 — projects table for capital-raise use cases
--
-- The original `products` table was modelled around SaaS partnership-discovery
-- (icp_buyer_title, icp_stack_tools, etc). For F2K's use case the operator is
-- raising capital for a portfolio of real-estate developments — each project
-- is its own investable asset with its own ICP. SaaS vocabulary doesn't fit.
--
-- This migration adds a parallel `projects` table with project-specific
-- fields (sponsor, project_type, funding_target, geography, asset_class).
-- The existing `products` table stays for the SaaS path (deactivated rows
-- like Storefront-MCP), and `partners` + `product_sources` get nullable
-- project_id columns so the same partner/source row can belong to either
-- a product or a project.
--
-- Per CLAUDE.md REVENUE-tier discipline: RLS enabled, idempotent, indexed.

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- Free-form for now. When multi-sponsor patterns emerge, promote to its
  -- own sponsors table referencing this column.
  sponsor text NOT NULL DEFAULT '',
  name text NOT NULL,
  description text,
  -- What's being raised. 'senior_debt' / 'mezzanine' / 'equity' /
  -- 'platform_equity' (equity in the parent company, not a project SPV) /
  -- 'mixed' for combined facilities.
  project_type text CHECK (project_type IN ('senior_debt', 'mezzanine', 'equity', 'platform_equity', 'mixed')),
  funding_target text, -- e.g. "$16.2M @ 8.5% indicative, first-mortgage"
  geography text,      -- e.g. "Claremont, Tasmania"
  asset_class text,    -- e.g. "Residential modular construction"
  -- ICP fields — describe the BUYER/INVESTOR/LENDER, never the operator.
  -- Schema names retained from products for renderer/scorer reuse.
  icp_buyer_title text,
  icp_user_title text,
  icp_company_size text,
  icp_stage text,
  icp_verticals text,
  icp_stack_tools text,
  customer_outcomes text,
  core_mechanism text,
  traction_arr text,
  traction_customers text,
  partner_types text DEFAULT 'lender',
  exclusions text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON public.projects(organisation_id);
CREATE INDEX IF NOT EXISTS idx_projects_active ON public.projects(organisation_id, is_active) WHERE is_active = true;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY projects_org_isolation ON public.projects
    FOR ALL TO authenticated
    USING (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ))
    WITH CHECK (organisation_id IN (
      SELECT organisation_id FROM public.profiles WHERE id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auto-update trigger (reuses function from migration 001 if present)
DO $$ BEGIN
  CREATE TRIGGER set_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

-- =============================================================================
-- partners.project_id — partners are discovered FOR a specific project.
-- Nullable for backward compat with existing rows that were tied to a product.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'partners'
      AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.partners
      ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_partners_project
  ON public.partners(project_id)
  WHERE project_id IS NOT NULL;

-- =============================================================================
-- product_sources.project_id — Knowledge Base sources can belong to either a
-- product (SaaS path) or a project (capital-raise path). Polymorphic via two
-- nullable FK columns; the application enforces that exactly one is set.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_sources'
      AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.product_sources
      ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

    -- product_id was NOT NULL on the original schema. Make it nullable so a
    -- row can belong to a project instead. Application-layer check that at
    -- least one of (product_id, project_id) is set.
    ALTER TABLE public.product_sources
      ALTER COLUMN product_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_sources_project
  ON public.product_sources(project_id)
  WHERE project_id IS NOT NULL;
