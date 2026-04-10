import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Agent memory module — adapted from Kira's memory loop pattern.
 * All state lives in Supabase. Each serverless invocation is stateless,
 * rebuilding context from DB via get_agent_context() RPC.
 */

export interface AgentContext {
  recent_messages: Array<{
    role: string;
    content: unknown;
    message_index: number;
  }>;
  memories: Array<{
    memory_type: string;
    content: string;
    importance: number;
  }>;
  message_count: number;
}

export async function getAgentContext(
  db: SupabaseClient,
  sessionId: string,
  messageLimit = 20
): Promise<AgentContext> {
  const { data, error } = await db.rpc('get_agent_context', {
    p_session_id: sessionId,
    p_message_limit: messageLimit,
  });

  if (error) {
    console.error('[MEMORY] get_agent_context failed:', error.message);
    return { recent_messages: [], memories: [], message_count: 0 };
  }

  return data as AgentContext;
}

export async function saveMessage(
  db: SupabaseClient,
  sessionId: string,
  role: 'user' | 'assistant' | 'tool_result',
  content: unknown
): Promise<void> {
  // Get current max message_index
  const { data: last } = await db
    .from('agent_messages')
    .select('message_index')
    .eq('session_id', sessionId)
    .order('message_index', { ascending: false })
    .limit(1)
    .single();

  const nextIndex = (last?.message_index ?? -1) + 1;

  const { error } = await db.from('agent_messages').insert({
    session_id: sessionId,
    role,
    content,
    message_index: nextIndex,
  });

  if (error) {
    console.error('[MEMORY] saveMessage failed:', error.message);
  }
}

export async function saveMemory(
  db: SupabaseClient,
  sessionId: string,
  organisationId: string,
  memoryType: string,
  content: string,
  importance = 5
): Promise<void> {
  const { error } = await db.from('agent_memories').insert({
    session_id: sessionId,
    organisation_id: organisationId,
    memory_type: memoryType,
    content,
    importance,
  });

  if (error) {
    console.error('[MEMORY] saveMemory failed:', error.message);
  }
}
