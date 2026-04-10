-- Agent memory tables (adapted from Kira's memory loop pattern)
-- Enables stateless serverless invocations with full context recovery

-- Conversation messages for agent turns
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_result')),
  content JSONB NOT NULL,
  message_index INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id, message_index);

-- Agent memory table for persistent insights across chunks
CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INT DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_session ON agent_memories(session_id, active);

-- RLS policies
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (our API routes use service client)
CREATE POLICY "Service role full access on agent_messages"
  ON agent_messages FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on agent_memories"
  ON agent_memories FOR ALL
  USING (true) WITH CHECK (true);

-- RPC: get agent conversation context (single call returns everything needed to resume)
CREATE OR REPLACE FUNCTION get_agent_context(p_session_id UUID, p_message_limit INT DEFAULT 20)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'recent_messages', COALESCE((
      SELECT jsonb_agg(sub ORDER BY sub.message_index ASC)
      FROM (
        SELECT role, content, message_index
        FROM agent_messages
        WHERE session_id = p_session_id
        ORDER BY message_index DESC
        LIMIT p_message_limit
      ) sub
    ), '[]'::jsonb),
    'memories', COALESCE((
      SELECT jsonb_agg(mem ORDER BY mem.importance DESC)
      FROM (
        SELECT memory_type, content, importance
        FROM agent_memories
        WHERE session_id = p_session_id AND active = true
        ORDER BY importance DESC
        LIMIT 10
      ) mem
    ), '[]'::jsonb),
    'message_count', (SELECT COUNT(*) FROM agent_messages WHERE session_id = p_session_id)
  );
$$ LANGUAGE sql STABLE;
