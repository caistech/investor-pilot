/**
 * InvestorPilot adapter over `@caistech/ai-client`.
 *
 * Single source of truth for Claude client construction across the project.
 * Replaces the inline `new Anthropic({...})` + MODEL pattern that was
 * duplicated across pipeline routes, discovery, sequencer, and agent code.
 *
 * Usage:
 *   import { claudeClient, claudeModel } from '@/lib/llm/client';
 *   const reply = await claudeClient.messages.create({ model: claudeModel, ... });
 */

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClientConfig, resolveClaudeModel } from '@caistech/ai-client';

const APP_TITLE = 'InvestorPilot';
const DEFAULT_REFERER = 'https://investorpilot.vercel.app';

/** Configured Claude client. Routes through OpenRouter when OPENROUTER_API_KEY is set. */
export const claudeClient = new Anthropic(
  getClaudeClientConfig({
    openrouterKey: process.env.OPENROUTER_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    referer: process.env.NEXT_PUBLIC_APP_URL || DEFAULT_REFERER,
    appTitle: APP_TITLE,
  }),
);

/** Model ID for the active provider. AGENT_MODEL env var overrides the default. */
export const claudeModel: string = resolveClaudeModel({
  openrouterKey: process.env.OPENROUTER_API_KEY,
  override: process.env.AGENT_MODEL,
});
