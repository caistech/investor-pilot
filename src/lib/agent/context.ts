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
      content: 'Begin the investor discovery process. Start by generating categories of potential partner companies.',
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
      content: 'Continue the investor discovery process from where you left off.',
    }];
  }

  // ── Full-pass tool_use / tool_result pairing validation ──
  // Collect every tool_use id and every tool_result id across ALL messages,
  // then strip orphans regardless of where they appear in the array.

  type ContentBlock = { type: string; id?: string; tool_use_id?: string };

  // 1. Gather all IDs
  const allToolUseIds = new Set<string>();
  const allToolResultIds = new Set<string>();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content as ContentBlock[]) {
      if (b.type === 'tool_use' && b.id) allToolUseIds.add(b.id);
      if (b.type === 'tool_result' && b.tool_use_id) allToolResultIds.add(b.tool_use_id);
    }
  }

  // 2. Find orphans: tool_use without matching tool_result & vice versa
  const orphanedToolUseIds = new Set<string>(
    Array.from(allToolUseIds).filter((id) => !allToolResultIds.has(id))
  );
  const orphanedToolResultIds = new Set<string>(
    Array.from(allToolResultIds).filter((id) => !allToolUseIds.has(id))
  );

  // 3. Strip orphaned blocks from messages (remove blocks, then remove empty messages)
  if (orphanedToolUseIds.size > 0 || orphanedToolResultIds.size > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!Array.isArray(msg.content)) continue;

      const blocks = msg.content as ContentBlock[];
      const filtered = blocks.filter((b) => {
        if (b.type === 'tool_use' && b.id && orphanedToolUseIds.has(b.id)) return false;
        if (b.type === 'tool_result' && b.tool_use_id && orphanedToolResultIds.has(b.tool_use_id)) return false;
        return true;
      });

      if (filtered.length === 0) {
        messages.splice(i, 1);
      } else if (filtered.length !== blocks.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (msg as any).content = filtered;
      }
    }
  }

  // Ensure conversation starts with a user message (API requirement)
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({
      role: 'user',
      content: 'Continue the investor discovery process from where you left off.',
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
  existingPartners: Array<{ company_name: string; domain: string; status: string }>,
  productUrl?: string | null
): string {
  let prompt = buildSystemPrompt(product, sourceContent, mode, productUrl);

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
