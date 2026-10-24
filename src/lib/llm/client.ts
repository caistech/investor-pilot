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

let cachedClient: Anthropic | null = null;

function buildClient(): Anthropic {
  return new Anthropic(
    getClaudeClientConfig({
      openrouterKey: process.env.OPENROUTER_API_KEY,
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      referer: process.env.NEXT_PUBLIC_APP_URL || DEFAULT_REFERER,
      appTitle: APP_TITLE,
    }),
  );
}

/**
 * Configured Claude client. Routes through OpenRouter when OPENROUTER_API_KEY is set.
 *
 * LAZY ON PURPOSE. This module used to construct the client at import time, and
 * `getClaudeClientConfig` throws when neither key is set — so `next build` failed while
 * collecting page data for /api/cron/sequencer, because a build has no runtime secrets and is
 * not supposed to need them. Constructing on first property access keeps every call site
 * (`claudeClient.messages.create(...)`) unchanged and moves the requirement to request time,
 * which is where the keys actually exist.
 */
export const claudeClient: Anthropic = new Proxy({} as Anthropic, {
  get(_target, property) {
    cachedClient ??= buildClient();
    const value = Reflect.get(cachedClient, property, cachedClient);
    // SDK methods read `this`; hand them the real client rather than the proxy.
    return typeof value === 'function' ? value.bind(cachedClient) : value;
  },
});

/** Model ID for the active provider. AGENT_MODEL env var overrides the default. */
export const claudeModel: string = resolveClaudeModel({
  openrouterKey: process.env.OPENROUTER_API_KEY,
  override: process.env.AGENT_MODEL,
});
