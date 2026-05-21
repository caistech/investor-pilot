import type Anthropic from '@anthropic-ai/sdk';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { getProductSourceContent, getProductWebsiteUrl } from '@/lib/agent/sources';
import { getAgentContext, saveMessage } from '@/lib/agent/memory';
import { TOOL_DEFINITIONS, executeTool } from '@/lib/agent/tools';
import { buildMessages, buildFullSystemPrompt } from '@/lib/agent/context';
import type { AgentAction } from '@/lib/agent/context';
import { claudeClient as client, claudeModel as MODEL } from '@/lib/llm/client';

export const maxDuration = 60;

async function callLLM(params: {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  max_tokens: number;
}): Promise<Anthropic.Message> {
  return client.messages.create({
    model: MODEL,
    ...params,
  });
}
const TIMEOUT_MS = 55000; // 5s safety margin before Vercel's 60s limit (Pro plan)

export async function POST(request: Request) {
  const { user, db, error } = await authenticateAndGetDb();
  if (error) return error;

  const { session_id, action } = await request.json() as { session_id: string; action: AgentAction };

  // Load session
  const { data: session } = await db
    .from('agent_sessions')
    .select('*')
    .eq('id', session_id)
    .single();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Load product
  const { data: product } = await db
    .from('products')
    .select('*')
    .eq('id', session.product_id)
    .single();

  if (!product) {
    return new Response(JSON.stringify({ error: 'Product not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Load profile for organisation_id
  const { data: profile } = await db
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user!.id)
    .single();

  const organisationId = profile?.active_organisation_id || session.organisation_id;

  // Load source content and product website URL
  const [sourceContent, productUrl] = await Promise.all([
    getProductSourceContent(product.id),
    getProductWebsiteUrl(product.id),
  ]);

  // Load existing partners for this product
  const { data: existingPartners } = await db
    .from('partners')
    .select('company_name, domain, status')
    .eq('organisation_id', organisationId)
    .eq('product_id', product.id);

  // Load agent context from DB (Kira memory pattern)
  const agentContext = await getAgentContext(db, session_id, 50);

  // Build system prompt with memories and existing partners
  const systemPrompt = buildFullSystemPrompt(
    product,
    sourceContent,
    session.mode || 'guided',
    agentContext,
    existingPartners || [],
    productUrl
  );

  // Build messages array
  const messages = buildMessages(agentContext, action);

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const startTime = Date.now();
      let currentMessages = [...messages];
      // Accumulate counters across chunks instead of resetting
      let partnersAdded = session.partners_added || 0;
      let contactsFound = session.contacts_found || 0;
      let draftsCreated = session.drafts_filed || 0;

      try {
        // Update session to active
        await db
          .from('agent_sessions')
          .update({ status: 'active', current_stage: 'running' })
          .eq('id', session_id);

        // Agentic loop
        while (true) {
          // Check timeout
          if (Date.now() - startTime > TIMEOUT_MS) {
            emit({ type: 'continue', message: 'Continuing in next chunk...' });
            break;
          }

          // Sanitise: rebuild messages to guarantee Anthropic format rules.
          // Rules: (1) must start with user, (2) roles alternate, (3) every
          // tool_use in assistant[i] must have tool_result in user[i+1],
          // (4) every tool_result in user[i] must match tool_use in assistant[i-1].
          {
            type CB = { type: string; id?: string; tool_use_id?: string };
            const clean: Anthropic.MessageParam[] = [];

            for (let i = 0; i < currentMessages.length; i++) {
              const msg = currentMessages[i];

              // Skip non-alternating duplicates
              if (clean.length > 0 && clean[clean.length - 1].role === msg.role) continue;

              if (msg.role === 'user' && Array.isArray(msg.content)) {
                const blocks = msg.content as CB[];
                const hasToolResults = blocks.some(b => b.type === 'tool_result');
                if (hasToolResults) {
                  // Validate: every tool_result must match a tool_use in the previous clean message
                  const prev = clean[clean.length - 1];
                  const prevTU = new Set<string>();
                  if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
                    for (const b of prev.content as CB[]) {
                      if (b.type === 'tool_use' && b.id) prevTU.add(b.id);
                    }
                  }
                  const validResults = blocks.filter(b => {
                    if (b.type === 'tool_result' && b.tool_use_id) return prevTU.has(b.tool_use_id);
                    return true; // keep non-tool-result blocks
                  });
                  if (validResults.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    clean.push({ role: 'user', content: validResults as any });
                  }
                  continue;
                }
              }

              if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                const blocks = msg.content as CB[];
                const hasToolUse = blocks.some(b => b.type === 'tool_use');
                if (hasToolUse) {
                  // Look ahead: find matching tool_results in next user message
                  const nextMsg = currentMessages[i + 1];
                  const nextTR = new Set<string>();
                  if (nextMsg && nextMsg.role === 'user' && Array.isArray(nextMsg.content)) {
                    for (const b of nextMsg.content as CB[]) {
                      if (b.type === 'tool_result' && b.tool_use_id) nextTR.add(b.tool_use_id);
                    }
                  }
                  // Keep only tool_use blocks that have matching results, plus all non-tool_use blocks
                  const validBlocks = blocks.filter(b => {
                    if (b.type === 'tool_use' && b.id) return nextTR.has(b.id);
                    return true; // keep text blocks etc.
                  });
                  if (validBlocks.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    clean.push({ role: 'assistant', content: validBlocks as any });
                  }
                  continue;
                }
              }

              clean.push(msg);
            }

            // Ensure starts with user
            if (clean.length === 0 || clean[0].role !== 'user') {
              clean.unshift({ role: 'user', content: 'Continue the investor discovery process.' });
            }

            currentMessages.length = 0;
            for (const m of clean) currentMessages.push(m);
          }

          // Call LLM with tools (retry on 529/overloaded)
          let response: Anthropic.Message | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              response = await callLLM({
                system: systemPrompt,
                tools: TOOL_DEFINITIONS,
                messages: currentMessages,
                max_tokens: 4096,
              });
              break;
            } catch (apiErr) {
              const status = (apiErr as { status?: number }).status;
              const retryable = [429, 403, 529, 503].includes(status || 0);
              if (retryable && attempt < 2 && Date.now() - startTime < TIMEOUT_MS - 10000) {
                const delay = (attempt + 1) * 3000;
                const msg = status === 403 ? 'Rate limited, waiting...' : `API busy, retrying in ${delay / 1000}s...`;
                emit({ type: 'event', event_type: 'stage_progress', event_data: { message: msg } });
                await new Promise((r) => setTimeout(r, delay));
                continue;
              }
              // On non-retryable or exhausted retries, emit continue to auto-resume later
              if (retryable) {
                emit({ type: 'event', event_type: 'agent_error', event_data: { error: `Rate limited (${status}). Will auto-resume.` } });
                emit({ type: 'continue', message: 'Rate limited, continuing in next chunk...' });
                controller.close();
                return;
              }
              throw apiErr;
            }
          }
          if (!response) throw new Error('Failed to get response after retries');

          // Save assistant response to DB
          await saveMessage(db, session_id, 'assistant', response.content);

          // Check if Claude is done (no tool use, end_turn)
          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          );

          if (response.stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
            // Claude thinks it's done — but check if it actually completed all phases
            const textBlock = response.content.find(
              (b): b is Anthropic.TextBlock => b.type === 'text'
            );

            // If no partners saved yet, the agent searched but didn't screen/score.
            // Send it back with a nudge to continue.
            if (partnersAdded === 0 && Date.now() - startTime < TIMEOUT_MS - 15000) {
              // Check if any category_searched events exist (meaning searches happened)
              const { count } = await db
                .from('session_events')
                .select('id', { count: 'exact', head: true })
                .eq('session_id', session_id)
                .eq('event_type', 'category_searched');

              if (count && count > 0) {
                if (textBlock) {
                  emit({ type: 'agent_message', content: textBlock.text });
                }
                currentMessages.push({
                  role: 'assistant',
                  content: response.content,
                });
                currentMessages.push({
                  role: 'user',
                  content: 'You searched for candidates but did not screen, score, or save any partners. Continue from Phase 3 (Screening) now. Screen the candidates you found, score the ones that pass, and save them with save_partner. Then continue through contact finding, motion selection, and drafting.',
                });
                continue;
              }
            }

            // If partners saved but no drafts, the agent stopped before drafting.
            if (draftsCreated === 0 && partnersAdded > 0 && Date.now() - startTime < TIMEOUT_MS - 15000) {
              if (textBlock) {
                emit({ type: 'agent_message', content: textBlock.text });
              }
              currentMessages.push({
                role: 'assistant',
                content: response.content,
              });
              currentMessages.push({
                role: 'user',
                content: 'You have not completed all phases yet. You scored partners but did not find contacts, select motions, or draft emails. Continue from Phase 5 (Research) now. Do NOT end your turn until you have completed Phase 8 (Draft Outreach) for the top partners with verified contacts.',
              });
              continue;
            }

            if (textBlock) {
              emit({ type: 'agent_message', content: textBlock.text });
            }

            // Update session as completed
            await db
              .from('agent_sessions')
              .update({
                status: 'completed',
                current_stage: 'complete',
                completed_at: new Date().toISOString(),
                partners_added: partnersAdded,
                contacts_found: contactsFound,
                drafts_filed: draftsCreated,
              })
              .eq('id', session_id);

            emit({
              type: 'pipeline_complete',
              summary: { partners_added: partnersAdded, contacts_found: contactsFound, drafts_created: draftsCreated },
            });
            break;
          }

          // Execute tool calls
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (let toolIdx = 0; toolIdx < toolUseBlocks.length; toolIdx++) {
            const block = toolUseBlocks[toolIdx];

            // Check timeout before each tool
            if (Date.now() - startTime > TIMEOUT_MS) {
              // Add placeholder results for ALL remaining unexecuted tools
              for (let j = toolIdx; j < toolUseBlocks.length; j++) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlocks[j].id,
                  content: JSON.stringify({ error: 'Timed out — will retry on next chunk' }),
                });
              }
              await saveMessage(db, session_id, 'tool_result', toolResults);
              emit({ type: 'continue', message: 'Continuing in next chunk...' });
              controller.close();
              return;
            }

            // Handle request_approval specially
            if (block.name === 'request_approval') {
              const input = block.input as { message: string; approval_type: string };

              // Save the approval request event
              await db.from('session_events').insert({
                session_id,
                partner_id: null,
                event_type: 'approval_required',
                event_data: { message: input.message, approval_type: input.approval_type },
              });

              // Build complete tool results including approval + any remaining tools
              const approvalResult: Anthropic.ToolResultBlockParam = {
                type: 'tool_result',
                tool_use_id: block.id,
                content: 'Approval requested. Waiting for user response.',
              };
              toolResults.push(approvalResult);

              // Add placeholder results for any remaining unexecuted tools after this one
              for (let j = toolIdx + 1; j < toolUseBlocks.length; j++) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlocks[j].id,
                  content: JSON.stringify({ status: 'deferred_for_approval' }),
                });
              }
              await saveMessage(db, session_id, 'tool_result', toolResults);

              // Update session stage
              await db
                .from('agent_sessions')
                .update({
                  current_stage: `awaiting_approval:${input.approval_type}`,
                  partners_added: partnersAdded,
                  contacts_found: contactsFound,
                  drafts_filed: draftsCreated,
                })
                .eq('id', session_id);

              emit({
                type: 'approval_required',
                message: input.message,
                approval_type: input.approval_type,
              });
              controller.close();
              return;
            }

            // Execute the tool
            const toolContext = {
              db,
              sessionId: session_id,
              organisationId,
              productId: product.id,
            };

            const result = await executeTool(block.name, block.input as Record<string, unknown>, toolContext);

            // Track counters
            const resultStatus = (result as Record<string, unknown>).status as string;
            if (block.name === 'save_partner' && (resultStatus === 'created' || resultStatus === 'updated')) {
              partnersAdded++;
            }
            if (block.name === 'save_contact' && (resultStatus === 'updated' || resultStatus === 'skipped')) {
              contactsFound++;
            }
            if (block.name === 'save_draft') {
              draftsCreated++;
            }

            // Stream the event to client
            if (block.name === 'emit_event') {
              const input = block.input as { event_type: string; event_data: Record<string, unknown> };
              emit({ type: 'event', event_type: input.event_type, event_data: input.event_data });
            } else if (block.name !== 'save_memory') {
              // Stream tool execution for visibility (skip memory saves, they're internal)
              emit({ type: 'tool_executed', tool: block.name, input: block.input });
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          }

          // Save all tool results to DB
          await saveMessage(db, session_id, 'tool_result', toolResults);

          // Build next turn
          currentMessages.push({
            role: 'assistant',
            content: response.content,
          });
          currentMessages.push({
            role: 'user',
            content: toolResults,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AGENT] Error:', message);

        // Save error event
        await db.from('session_events').insert({
          session_id,
          partner_id: null,
          event_type: 'agent_error',
          event_data: { error: message },
        });

        emit({ type: 'error', message });
      } finally {
        try {
          // Update session counters
          await db
            .from('agent_sessions')
            .update({
              partners_added: partnersAdded,
              contacts_found: contactsFound,
              drafts_filed: draftsCreated,
            })
            .eq('id', session_id);
        } catch {
          // Best effort
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
