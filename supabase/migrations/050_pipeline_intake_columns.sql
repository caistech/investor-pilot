-- Add pipeline intake columns to products table
-- For receiving products from Corporate AI Solutions pipeline

ALTER TABLE products ADD COLUMN IF NOT EXISTS external_product_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS distributor_icp TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS distributor_pitch TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS end_user_icp TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS friction TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS regulated_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cta_destination TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cta_events TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS validation_hard_gates_passed INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS validation_weighted_score NUMERIC(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS validation_gates_ready BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS intake_source TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS intake_timestamp TIMESTAMPTZ;

-- Unique constraint for external_product_id per organisation
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_external_product_id_org 
ON products(external_product_id, organisation_id) 
WHERE external_product_id IS NOT NULL;

-- Channels table for tracking outreach channels per product
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_product_id ON channels(product_id);
CREATE INDEX IF NOT EXISTS idx_channels_organisation_id ON channels(organisation_id);
