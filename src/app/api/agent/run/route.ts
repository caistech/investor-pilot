import Anthropic from '@anthropic-ai/sdk';
import { authenticateAndGetDb } from '@/lib/agent/db';
import { getProductSourceContent } from '@/lib/agent/sources';
import { getAgentContext, saveMessage } from '@/lib/agent/memory';
import { TOOL_DEFINITIONS, executeTool } from '@/lib/agent/tools';
import { buildMessages, buildFullSystemPrompt } from '@/lib/agent/context';
import type { AgentAction } from '@/lib/agent/context';

export const maxDuration = 30;

// Use OpenRouter as primary provider for resilience
// Falls back to direct Anthropic if OPENROUTER_API_KEY is not set
const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const OPENROUTER_MODEL = process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4.6';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

// OpenRouter-compatible messages.create via fetch
async function callLLM(params: {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  max_tokens: number;
}): Promise<Anthropic.Message> {
  if (!useOpenRouter) {
    return anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      ...params,
    });
  }

  // OpenRouter uses the Anthropic messages format at /api/v1/chat/completions
  // but we need to use their Anthropic-compatible endpoint
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://partner-pilot-theta.vercel.app',
      'X-Title': 'PartnerPilot',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: params.max_tokens,
      messages: [
        { role: 'system', content: params.system },
        ...params.messages.map((m) => {
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            // Convert Anthropic tool_use blocks to OpenAI format
            const textParts = (m.content as Anthropic.ContentBlock[]).filter((b) => b.type === 'text');
            const toolParts = (m.content as Anthropic.ContentBlock[]).filter((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
            return {
              role: 'assistant',
              content: textParts.length > 0 ? (textParts[0] as Anthropic.TextBlock).text : null,
              tool_calls: toolParts.length > 0 ? toolParts.map((t) => ({
                id: t.id,
                type: 'function',
                function: { name: t.name, arguments: JSON.stringify(t.input) },
              })) : undefined,
            };
          }
          if (m.role === 'user' && Array.isArray(m.content)) {
            // Convert Anthropic tool_result blocks to OpenAI format
            const toolResults = (m.content as Anthropic.ToolResultBlockParam[]).filter((b) => b.type === 'tool_result');
            if (toolResults.length > 0) {
              return toolResults.map((r) => ({
                role: 'tool' as const,
                tool_call_id: r.tool_use_id,
                content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
              }));
            }
            return m;
          }
          return m;
        }).flat(),
      ],
      tools: params.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`OpenRouter error: ${res.status} ${body}`), { status: res.status });
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('No response from OpenRouter');

  // Convert OpenAI format back to Anthropic format
  const content: Anthropic.ContentBlock[] = [];
  if (choice.message?.content) {
    content.push({ type: 'text', text: choice.message.content } as Anthropic.TextBlock);
  }
  if (choice.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}'),
      } as Anthropic.ToolUseBlock);
    }
  }

  return {
    id: data.id || 'msg_openrouter',
    type: 'message',
    role: 'assistant',
    content,
    model: data.model || OPENROUTER_MODEL,
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
  } as Anthropic.Message;
}
const TIMEOUT_MS = 24000; // 6s safety margin before Vercel's 30s hard kill

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
    .select('organisation_id')
    .eq('id', user!.id)
    .single();

  const organisationId = profile?.organisation_id || session.organisation_id;

  // Load source content
  const sourceContent = await getProductSourceContent(product.id);

  // Load existing partners for this product
  const { data: existingPartners } = await db
    .from('partners')
    .select('company_name, domain, status')
    .eq('organisation_id', organisationId)
    .eq('product_id', product.id);

  // Load agent context from DB (Kira memory pattern)
  const agentContext = await getAgentContext(db, session_id);

  // Build system prompt with memories and existing partners
  const systemPrompt = buildFullSystemPrompt(
    product,
    sourceContent,
    session.mode || 'guided',
    agentContext,
    existingPartners || []
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
      let partnersAdded = 0;
      let contactsFound = 0;
      let draftsCreated = 0;

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
              if ((status === 529 || status === 503) && attempt < 2 && Date.now() - startTime < TIMEOUT_MS - 5000) {
                const delay = (attempt + 1) * 2000;
                emit({ type: 'event', event_type: 'stage_progress', event_data: { message: `API busy, retrying in ${delay / 1000}s...` } });
                await new Promise((r) => setTimeout(r, delay));
                continue;
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
            // Claude is done — extract any text response
            const textBlock = response.content.find(
              (b): b is Anthropic.TextBlock => b.type === 'text'
            );
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
            if (block.name === 'save_partner' && (result as Record<string, unknown>).status === 'created') {
              partnersAdded++;
            }
            if (block.name === 'save_contact' && (result as Record<string, unknown>).status === 'updated') {
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
