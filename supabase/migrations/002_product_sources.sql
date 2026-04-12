-- Product sources: knowledge base for product context
-- Stores URLs, uploaded file content, and pasted text that inform the pipeline

create table if not exists public.product_sources (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade not null,
  organisation_id uuid references public.organisations(id) on delete cascade not null,
  source_type text not null check (source_type in ('url', 'file', 'text')),
  title text not null,
  url text,
  content text, -- extracted text content
  file_name text,
  file_type text, -- mime type
  file_size integer, -- bytes
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists idx_product_sources_product on public.product_sources(product_id);
create index if not exists idx_product_sources_org on public.product_sources(organisation_id);

-- RLS
alter table public.product_sources enable row level security;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own org sources' AND tablename = 'product_sources') THEN
    CREATE POLICY "Users can view own org sources"
      on public.product_sources for select
      using (organisation_id in (select organisation_id from public.profiles where id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own org sources' AND tablename = 'product_sources') THEN
    CREATE POLICY "Users can insert own org sources"
      on public.product_sources for insert
      with check (organisation_id in (select organisation_id from public.profiles where id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own org sources' AND tablename = 'product_sources') THEN
    CREATE POLICY "Users can update own org sources"
      on public.product_sources for update
      using (organisation_id in (select organisation_id from public.profiles where id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own org sources' AND tablename = 'product_sources') THEN
    CREATE POLICY "Users can delete own org sources"
      on public.product_sources for delete
      using (organisation_id in (select organisation_id from public.profiles where id = auth.uid()));
  END IF;
END $$;

-- Updated_at trigger (skip if exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_product_sources_updated_at') THEN
    CREATE TRIGGER set_product_sources_updated_at
      BEFORE UPDATE ON public.product_sources
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;
