import type { Product } from '@/lib/types';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentContext } from './memory';
import { buildSystemPrompt } from './system-prompt';

export type AgentAction = 'start' | 'continue' | 'approve';

/**
 * Build the messages array for the Claude agent conversation.
 *
 * - 'start': Fresh conversation with product context
 * - 'continue': Rebuild from DB messages (Kira pattern)
 * - 'approve': Rebuild + append user approval message
 */
export function buildMessages(
  agentContext: AgentContext,
  action: AgentAction
): Anthropic.MessageParam[] {
  if (action === 'start') {
    return [{
      role: 'user',
      content: 'Begin the partnership discovery process. Start by generating categories of potential partner companies.',
    }];
  }

  // For continue/approve, rebuild from DB messages
  const messages: Anthropic.MessageParam[] = [];

  // Reconstruct the conversation from recent_messages
  // Messages come ordered by message_index ASC from the RPC
  for (const msg of agentContext.recent_messages) {
    if (msg.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: msg.content as Anthropic.ContentBlock[],
      });
    } else if (msg.role === 'tool_result') {
      // Tool results go as 'user' role messages
      const toolContent = msg.content as { tool_use_id: string; result: unknown } | Array<{ tool_use_id: string; result: unknown }>;
      const results = Array.isArray(toolContent) ? toolContent : [toolContent];
      messages.push({
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.tool_use_id,
          content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
        })),
      });
    } else if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: msg.content as string,
      });
    }
  }

  // For approve action, append the approval message
  if (action === 'approve') {
    messages.push({
      role: 'user',
      content: 'The user has reviewed and approved. Continue to the next phase of the discovery process.',
    });
  }

  // If no messages found (shouldn't happen for continue/approve), start fresh
  if (messages.length === 0) {
    return [{
      role: 'user',
      content: 'Continue the partnership discovery process from where you left off.',
    }];
  }

  // Trim orphaned tool_results from the start — they reference tool_use blocks
  // that were in earlier messages outside the 20-message window
  while (messages.length > 0) {
    const first = messages[0];
    if (first.role === 'user' && Array.isArray(first.content)) {
      const hasToolResult = (first.content as Array<{ type: string }>).some(
        (b) => b.type === 'tool_result'
      );
      if (hasToolResult) {
        messages.shift();
        continue;
      }
    }
    break;
  }

  // Also trim any assistant messages at the start that have tool_use blocks
  // without their matching tool_results (orphaned from the other direction)
  while (messages.length > 0 && messages[0].role === 'assistant') {
    const content = messages[0].content;
    if (Array.isArray(content) && content.some((b: { type: string }) => b.type === 'tool_use')) {
      // Check if next message has matching tool_results
      if (messages.length < 2 || messages[1].role !== 'user') {
        messages.shift();
        continue;
      }
    }
    break;
  }

  // Trim orphaned tool_use from the END — the last assistant message may have
  // tool_use blocks whose tool_results are outside the 20-message window
  while (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && Array.isArray(last.content)) {
      const hasToolUse = (last.content as Array<{ type: string }>).some(
        (b) => b.type === 'tool_use'
      );
      if (hasToolUse) {
        messages.pop();
        continue;
      }
    }
    // Also trim trailing tool_results with no preceding tool_use
    if (last.role === 'user' && Array.isArray(last.content)) {
      const hasToolResult = (last.content as Array<{ type: string }>).some(
        (b) => b.type === 'tool_result'
      );
      if (hasToolResult && messages.length > 1) {
        const prev = messages[messages.length - 2];
        if (prev.role !== 'assistant' || !Array.isArray(prev.content) ||
            !(prev.content as Array<{ type: string }>).some((b) => b.type === 'tool_use')) {
          messages.pop();
          continue;
        }
      }
    }
    break;
  }

  // Ensure conversation starts with a user message (API requirement)
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({
      role: 'user',
      content: 'Continue the partnership discovery process from where you left off.',
    });
  }

  return messages;
}

/**
 * Build the full system prompt with memory context injected.
 */
export function buildFullSystemPrompt(
  product: Product,
  sourceContent: string,
  mode: 'guided' | 'batch',
  agentContext: AgentContext,
  existingPartners: Array<{ company_name: string; domain: string; status: string }>
): string {
  let prompt = buildSystemPrompt(product, sourceContent, mode);

  // Inject memories
  if (agentContext.memories.length > 0) {
    prompt += '\n\n## Session Memories\nThese insights were saved from earlier in this session:\n';
    for (const mem of agentContext.memories) {
      prompt += `- [${mem.memory_type}] (importance: ${mem.importance}) ${mem.content}\n`;
    }
  }

  // Inject existing partners
  if (existingPartners.length > 0) {
    prompt += '\n\n## Existing Partners\nThese partners already exist in the database. Do not recreate them.\n';
    for (const p of existingPartners) {
      prompt += `- ${p.company_name} (${p.domain}) — status: ${p.status}\n`;
    }
  }

  return prompt;
}
