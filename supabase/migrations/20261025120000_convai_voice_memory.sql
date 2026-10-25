-- elevenlabs-convai/migration.sql
-- Generic Supabase tables for ElevenLabs Conversational AI.
-- Copy and adapt for your project. Table names use convai_ prefix by default.
-- If your project already has these tables under different names (e.g., kira_agents),
-- pass custom tableNames to the webhook-handlers functions instead.
--
-- Prerequisites: pgcrypto (gen_random_uuid) + pg_trgm (fuzzy memory recall).
--
-- This file is a CONSUMER TEMPLATE. It is not applied to any shared/hub database;
-- each product applies it to its own Supabase project. It is idempotent and doubles
-- as an upgrade script for existing installs (see the UPGRADES section at the end).
--
-- Identity model (two kinds of user_id):
--   * Authed users  — user_id = auth.uid(); RLS lets them read their own rows.
--   * Anon sessions — user_id = a convai_anon_sessions.id (random UUID). These rows
--     are NOT client-readable (no anon SELECT policy); only the service role (your
--     webhook routes) touches them. Anon data is EPHEMERAL: no cross-session memory,
--     purged by purge_expired_anon_sessions() on a short TTL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- HELPER: updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 1. AGENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS convai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner (references your project's users table — adjust FK as needed)
  user_id UUID NOT NULL,

  -- Agent identity
  agent_name TEXT NOT NULL,

  -- ElevenLabs
  elevenlabs_agent_id TEXT UNIQUE NOT NULL,

  -- Agent configuration
  system_prompt TEXT,
  first_message TEXT,
  voice_id TEXT,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused', 'deleted')),

  -- Usage stats
  total_conversations INT DEFAULT 0,
  total_minutes INT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_conversation_at TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS trg_convai_agents_updated ON convai_agents;
CREATE TRIGGER trg_convai_agents_updated BEFORE UPDATE ON convai_agents
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- 2. ANON SESSIONS TABLE (ephemeral; no cross-session memory)
-- ============================================================================
-- One row per anonymous (unauthenticated) voice session. The row id is used as
-- the user_id on this session's conversations/messages/memory. Rows expire and
-- are deleted by purge_expired_anon_sessions(), cascading their data away.
CREATE TABLE IF NOT EXISTS convai_anon_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which agent the session is talking to
  agent_id UUID REFERENCES convai_agents(id) ON DELETE CASCADE,
  elevenlabs_agent_id TEXT,

  -- HMAC token hash (the signed token is held client-side for the live call only;
  -- we store its hash to allow server-side resolution + revocation within the TTL)
  token_hash TEXT,

  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_convai_anon_sessions_expires ON convai_anon_sessions (expires_at);


-- ============================================================================
-- 3. CONVERSATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS convai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  user_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES convai_agents(id) ON DELETE CASCADE,

  -- Anonymous-session linkage (NULL for authed users). CASCADE purges anon data.
  anon_session_id UUID REFERENCES convai_anon_sessions(id) ON DELETE CASCADE,

  -- Opt-in organisation scope; NULL means unscoped. Written and selected by 0.17+.
  --
  -- DELIBERATELY NOT A FOREIGN KEY. This template is applied to consumers that may have no
  -- organisations table at all (f2k-checkpoint is one), and `references organisations(id)` fails
  -- the whole migration there rather than completing it. A consumer that does have one can add the
  -- constraint itself; a wrong FK in a shared template is a broken migration in every such consumer.
  organisation_id UUID,

  -- ElevenLabs tracking
  elevenlabs_conversation_id TEXT UNIQUE,

  -- Session info
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT,

  -- Post-call processing guard: set once the post-call webhook has been handled.
  -- Gates exactly-once side-effects (onConversationComplete, stat increments).
  processed_at TIMESTAMPTZ,

  -- Content
  transcript_text TEXT,
  transcript_json JSONB,

  -- Topics discussed (for memory/continuity)
  topics TEXT[] DEFAULT '{}',
  last_topic TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  summary TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_convai_conversations_updated ON convai_conversations;
CREATE TRIGGER trg_convai_conversations_updated BEFORE UPDATE ON convai_conversations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- 4. MESSAGES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS convai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  conversation_id UUID NOT NULL REFERENCES convai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES convai_agents(id) ON DELETE CASCADE,

  -- Message content
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,

  -- Voice metadata
  audio_url TEXT,
  duration_ms INTEGER,

  -- Ordinal within the conversation. NOT NULL so the dedup unique index below
  -- actually fires (NULLs are distinct in Postgres). Both the mid-call save path
  -- and the post-call transcript path populate it.
  message_index INTEGER NOT NULL,

  -- Timestamps
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Retry-safe dedup: a re-delivered post-call webhook upserts onConflict-ignore
-- against this index instead of inserting duplicate transcript rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_convai_messages_conv_idx
  ON convai_messages (conversation_id, message_index);


-- ============================================================================
-- 5. MEMORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS convai_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner
  user_id UUID NOT NULL,
  -- NULLABLE, and deliberately so. `resolveToolIdentity` returns { userId, agentId? } and omits
  -- agentId on purpose, so recall scopes to the USER and survives the agent being re-provisioned.
  -- ElevenLabs never passes an agent id to a tool webhook either. This column was NOT NULL while
  -- the package's own documented behaviour made it optional — the package contradicted itself, and
  -- the result was that every memory write failed the constraint and the handler swallowed it
  -- behind a 200. Green status, nothing stored, for as long as nobody looked in the table.
  agent_id UUID REFERENCES convai_agents(id) ON DELETE CASCADE,

  -- Anonymous-session linkage (NULL for authed). CASCADE purges anon memory.
  -- Authed memory persists across sessions; anon memory is single-call only.
  anon_session_id UUID REFERENCES convai_anon_sessions(id) ON DELETE CASCADE,

  -- Opt-in organisation scope; NULL means unscoped. handleSaveMemory writes it on EVERY insert and
  -- getConversationBinding selects it, so a schema without this column fails every save with a
  -- Postgres error that the handler used to discard — green HTTP, empty table, an agent that
  -- remembers nothing. Two products hit that before this line existed here. No FK, same reason as
  -- convai_conversations above.
  organisation_id UUID,

  -- Memory classification
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'preference', 'context', 'goal', 'decision',
    'followup', 'correction', 'insight'
  )),

  -- The actual memory
  content TEXT NOT NULL,

  -- Source
  source_conversation_id UUID REFERENCES convai_conversations(id) ON DELETE SET NULL,

  -- Retrieval
  importance INT DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  tags TEXT[] DEFAULT '{}',

  -- Validity
  active BOOLEAN DEFAULT true,
  superseded_by UUID REFERENCES convai_memory(id),

  -- Usage tracking
  recall_count INT DEFAULT 0,
  last_recalled_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_convai_memory_updated ON convai_memory;
CREATE TRIGGER trg_convai_memory_updated BEFORE UPDATE ON convai_memory
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fuzzy content search (recall_memory uses ILIKE '%q%' — trigram-accelerated).
CREATE INDEX IF NOT EXISTS idx_convai_memory_content_trgm
  ON convai_memory USING gin (content gin_trgm_ops);


-- ============================================================================
-- 6. HOT-PATH INDEXES (latency-sensitive: call-start context + mid-call recall)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_convai_conversations_lookup
  ON convai_conversations (agent_id, user_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_convai_messages_conv_time
  ON convai_messages (conversation_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_convai_memory_recall
  ON convai_memory (agent_id, user_id, active, importance DESC);


-- ============================================================================
-- 7. MESSAGE INSERT TRIGGER (auto-update conversation stats)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE convai_conversations
  SET
    message_count = COALESCE(message_count, 0) + 1,
    last_message_at = NEW.timestamp,
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_conversation_on_message ON convai_messages;
CREATE TRIGGER trigger_update_conversation_on_message
AFTER INSERT ON convai_messages
FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();


-- ============================================================================
-- 8. CONVERSATION CONTEXT RPC
-- ============================================================================
-- Returns the user's prior context at the START of a conversation.
-- Memories are returned INDEPENDENTLY of conversation status, so a user whose
-- last call ended cleanly (status='completed') still gets remembered — the
-- earlier 'active'-only filter silently defeated cross-session memory.
CREATE OR REPLACE FUNCTION get_conversation_context(
  p_agent_id UUID,
  p_user_id UUID,
  p_message_limit INTEGER DEFAULT 20
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  last_conv RECORD;
  time_gap INTERVAL;
  memories_json JSON;
BEGIN
  -- Memories first — always, regardless of any conversation's status.
  SELECT COALESCE(json_agg(
    json_build_object(
      'id', mem.id,
      'type', mem.memory_type,
      'content', mem.content,
      'importance', mem.importance
    ) ORDER BY mem.importance DESC
  ), '[]'::json)
  INTO memories_json
  FROM (
    SELECT * FROM convai_memory
    -- agent_id IS NULL is INCLUDED on purpose, and it is the fix for the failure users actually
    -- report: recall works mid-call, and the next session knows nothing.
    --
    -- The server-baked identity path (`resolveToolIdentity`) documents agentId as OPTIONAL — omit it
    -- and recall spans the whole user, which is the correct choice for one-agent-per-user. So
    -- handleSaveMemory inserts agent_id NULL for every fact the agent saves through its tools. A
    -- strict `agent_id = p_agent_id` then hides exactly those rows from the connect-time context,
    -- while `has_history` still reports true off the conversation row — the agent is told it has met
    -- you and handed nothing to say about it.
    WHERE (agent_id = p_agent_id OR agent_id IS NULL)
      AND user_id = p_user_id
      AND active = true
    ORDER BY importance DESC, created_at DESC
    LIMIT 10
  ) mem;

  -- Most recent conversation across ANY status (active OR completed OR abandoned).
  SELECT
    c.id,
    c.last_message_at,
    c.last_topic,
    c.summary,
    c.message_count,
    c.title
  INTO last_conv
  FROM convai_conversations c
  WHERE c.agent_id = p_agent_id
    AND c.user_id = p_user_id
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 1;

  IF last_conv.id IS NULL THEN
    RETURN json_build_object(
      'has_history', false,
      'recent_messages', '[]'::json,
      'memories', memories_json
    );
  END IF;

  time_gap := NOW() - last_conv.last_message_at;

  SELECT json_build_object(
    'has_history', true,
    'conversation_id', last_conv.id,
    'last_message_at', last_conv.last_message_at,
    'time_gap_seconds', EXTRACT(EPOCH FROM time_gap)::INTEGER,
    'time_gap_category',
      CASE
        WHEN last_conv.last_message_at IS NULL THEN 'new'
        WHEN time_gap < INTERVAL '1 hour' THEN 'recent'
        WHEN time_gap < INTERVAL '1 day' THEN 'today'
        WHEN time_gap < INTERVAL '7 days' THEN 'this_week'
        ELSE 'older'
      END,
    'last_topic', last_conv.last_topic,
    'summary', last_conv.summary,
    'message_count', last_conv.message_count,
    'title', last_conv.title,
    'recent_messages', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', m.id,
          'role', m.role,
          'content', m.content,
          'timestamp', m.timestamp
        ) ORDER BY m.timestamp DESC
      ), '[]'::json)
      FROM (
        SELECT * FROM convai_messages
        WHERE conversation_id = last_conv.id
        ORDER BY timestamp DESC
        LIMIT p_message_limit
      ) m
    ),
    'memories', memories_json
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 9. ANON PURGE FUNCTION (run on a short cron, e.g. hourly)
-- ============================================================================
-- Deletes expired anonymous sessions; conversations + messages + memory cascade.
-- Anon voice data is ephemeral by design (no cross-session memory). Schedule via
-- pg_cron or an external cron hitting an endpoint that calls this.
CREATE OR REPLACE FUNCTION purge_expired_anon_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  WITH gone AS (
    DELETE FROM convai_anon_sessions WHERE expires_at < NOW() RETURNING 1
  )
  SELECT count(*) INTO deleted FROM gone;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE convai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE convai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE convai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE convai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE convai_anon_sessions ENABLE ROW LEVEL SECURITY;

-- Authed users see only their own rows. Anonymous rows (user_id = an anon-session
-- UUID, never equal to auth.uid()) match NO policy here, so they are not
-- client-readable — only the service role (your webhook routes) touches them.
-- Adjust these for your project's auth model.

DROP POLICY IF EXISTS "Users see own agents" ON convai_agents;
CREATE POLICY "Users see own agents" ON convai_agents
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users see own conversations" ON convai_conversations;
CREATE POLICY "Users see own conversations" ON convai_conversations
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users see own messages" ON convai_messages;
CREATE POLICY "Users see own messages" ON convai_messages
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users see own memories" ON convai_memory;
CREATE POLICY "Users see own memories" ON convai_memory
  FOR SELECT USING (user_id = auth.uid());

-- convai_anon_sessions: no client policy at all → service-role-only.

-- Service role bypasses RLS (for webhook handlers).
-- Your webhook routes should use createServiceClient().


-- ============================================================================
-- 11. UPGRADES (idempotent — for existing installs predating these columns)
-- ============================================================================
-- Fresh installs get everything from the CREATE TABLE blocks above; these ALTERs
-- bring an existing convai_* schema (or a kira_* clone) up to the new shape.

ALTER TABLE convai_conversations ADD COLUMN IF NOT EXISTS anon_session_id UUID REFERENCES convai_anon_sessions(id) ON DELETE CASCADE;
ALTER TABLE convai_conversations ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE convai_memory       ADD COLUMN IF NOT EXISTS anon_session_id UUID REFERENCES convai_anon_sessions(id) ON DELETE CASCADE;

-- convai_memory.agent_id: DROP NOT NULL.
--
-- THIS LINE IS THE FIX, not the CREATE TABLE change above. Fixing only the CREATE helps new
-- installs; every database already on this schema — Kira prod, BucketLyst prod, any kira_* clone —
-- keeps failing every memory write against the constraint and keeps swallowing it behind a 200.
-- A fix that doesn't reach existing databases doesn't fix the bug that is actually running.
--
-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op, so installs that patched
-- this locally (BucketLyst migration 0014) are unaffected.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'convai_memory' AND column_name = 'agent_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE convai_memory ALTER COLUMN agent_id DROP NOT NULL;
    RAISE NOTICE 'convai_memory.agent_id: dropped NOT NULL (memory writes were failing the constraint)';
  END IF;
END $$;

-- get_conversation_context: the agent_id predicate must admit NULL.
--
-- The §8 definition above is CREATE OR REPLACE, so re-running THIS file patches any database using
-- the default convai_* names. It cannot reach a product that CLONED the function against renamed
-- tables (Kira's kira_memory / kira_agent_id is the live example) — that copy lives in the product's
-- own migrations and keeps the strict predicate until the product changes it.
--
-- So: detect and say so, loudly, rather than assume. A WARNING and not an exception, because the
-- clone belongs to the consumer; failing their migration on our diagnosis would be the wrong owner
-- taking the wrong action.
DO $$
DECLARE
  stale TEXT;
BEGIN
  SELECT string_agg(format('%s.%s', n.nspname, p.proname), ', ')
  INTO stale
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'get_conversation_context'
    AND pg_get_functiondef(p.oid) LIKE '%agent_id = p_agent_id%'
    AND pg_get_functiondef(p.oid) NOT LIKE '%agent_id IS NULL%';

  IF stale IS NOT NULL THEN
    RAISE WARNING 'get_conversation_context (%) still filters agent_id = p_agent_id with no NULL branch. Tool-saved memories carry agent_id NULL, so cross-session recall returns has_history=true with an EMPTY memory list. Apply the same (agent_id = p_agent_id OR agent_id IS NULL) change to that definition.', stale;
  END IF;
END $$;

-- message_index: backfill any NULLs with a per-conversation ordinal, then enforce
-- NOT NULL so the dedup unique index is meaningful. Recomputing all rows keeps the
-- ordinal collision-free for the unique index.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'convai_messages' AND column_name = 'message_index'
      AND is_nullable = 'YES'
  ) THEN
    UPDATE convai_messages m
    SET message_index = sub.rn
    FROM (
      SELECT id, row_number() OVER (
        PARTITION BY conversation_id ORDER BY timestamp, created_at, id
      ) AS rn
      FROM convai_messages
    ) sub
    WHERE m.id = sub.id;

    ALTER TABLE convai_messages ALTER COLUMN message_index SET NOT NULL;
  END IF;
END $$;
