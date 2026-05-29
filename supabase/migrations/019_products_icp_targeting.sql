-- Add ICP targeting fields for tight Brave/LinkedIn search queries

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS icp_company_size TEXT,
  ADD COLUMN IF NOT EXISTS icp_stage TEXT,
  ADD COLUMN IF NOT EXISTS icp_buyer_title TEXT,
  ADD COLUMN IF NOT EXISTS icp_user_title TEXT,
  ADD COLUMN IF NOT EXISTS icp_stack_tools TEXT,
  ADD COLUMN IF NOT EXISTS traction_arr TEXT,
  ADD COLUMN IF NOT EXISTS traction_customers TEXT;

COMMENT ON COLUMN products.icp_company_size IS 'Target company employee count (e.g. 50-200, 10-50)';
COMMENT ON COLUMN products.icp_stage IS 'ICP business stage (seed, growth, scale, enterprise)';
COMMENT ON COLUMN products.icp_buyer_title IS 'Primary buyer job titles';
COMMENT ON COLUMN products.icp_user_title IS 'Primary user job titles';
COMMENT ON COLUMN products.icp_stack_tools IS 'Tools/systems ICP uses';
COMMENT ON COLUMN products.traction_arr IS 'Pricing/revenue stage';
COMMENT ON COLUMN products.traction_customers IS 'Current customer base';
