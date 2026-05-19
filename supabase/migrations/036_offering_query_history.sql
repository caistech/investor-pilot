-- 036 — Track query history per offering so Discovery can:
--   1. Avoid wasting Brave budget re-running identical queries each click
--   2. Paginate Brave's results (offset 0 → 20 → 40 → 60) when a query is
--      run multiple times for the same offering
--   3. Bias the LLM query-generator toward NEW queries each click
--
-- Operator flagged 2026-05-19: 'Brave and Hunter ought to be swamped with
-- possibilities so why aren't they?' Root cause was that each Find Buyers
-- click ran the same 10 queries against Brave page-1 and got the same
-- top results we already had. Tracking history lets us probe deeper.
--
-- Shape of query_history: JSONB array of { query: text, offset: int,
-- used_at: timestamp }. Each entry records one Brave API call. Next run
-- looks at prior offsets to know what offset to use this time.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS query_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS query_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Comment for ops:
COMMENT ON COLUMN products.query_history IS
  'Per-offering Brave query history. Each entry: { query, offset, used_at }. Used by discover-batch to paginate Brave + avoid repeating queries.';
COMMENT ON COLUMN projects.query_history IS
  'Per-offering Brave query history. Each entry: { query, offset, used_at }. Used by discover-batch to paginate Brave + avoid repeating queries.';
