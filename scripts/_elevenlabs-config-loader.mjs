/**
 * scripts/_elevenlabs-config-loader.mjs
 *
 * Tiny loader so the .mjs scripts can read the same agent config the
 * Vercel admin route uses (src/lib/elevenlabs/agent-config.ts). The TS
 * file isn't directly importable from node without a compiler, so we
 * read it as text and extract the constants via regex.
 *
 * If the TS file's format changes (e.g. you switch to `const X: string = ...`
 * with an explicit type annotation), update the extractor regexes below.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', 'src', 'lib', 'elevenlabs', 'agent-config.ts');

function extractTemplate(src, name) {
  // Matches `export const NAME = \`...multiline...\`;`
  const re = new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`, 'm');
  const m = src.match(re);
  return m ? m[1] : null;
}

function extractString(src, name) {
  // Matches `export const NAME = "...";` or `export const NAME = '...';`
  // Also handles `export const NAME: SomeType = '...';` (TS type annotation).
  const reDouble = new RegExp(`export const ${name}(?:\\s*:[^=]+)?\\s*=\\s*"([^"]*)";`, 'm');
  const reSingle = new RegExp(`export const ${name}(?:\\s*:[^=]+)?\\s*=\\s*'([^']*)';`, 'm');
  return (src.match(reDouble) ?? src.match(reSingle))?.[1] ?? null;
}

function extractArray(src, name) {
  // Matches `export const NAME = [ ... ];` capturing the inner block.
  const re = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`, 'm');
  const m = src.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
}

export function readAgentConfig() {
  const src = readFileSync(CONFIG_PATH, 'utf8');
  const cfg = {
    AGENT_NAME: extractString(src, 'AGENT_NAME'),
    SYSTEM_PROMPT: extractTemplate(src, 'SYSTEM_PROMPT'),
    FIRST_MESSAGE: extractString(src, 'FIRST_MESSAGE'),
    ALLOWED_ORIGINS: extractArray(src, 'ALLOWED_ORIGINS'),
    LANGUAGE: extractString(src, 'LANGUAGE') ?? 'en',
    WIDGET_PLACEMENT: extractString(src, 'WIDGET_PLACEMENT') ?? 'top-right',
  };
  const missing = ['AGENT_NAME', 'SYSTEM_PROMPT', 'FIRST_MESSAGE'].filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(
      `Failed to parse ${missing.join(', ')} from ${CONFIG_PATH}. ` +
      'Update the extractor regexes in scripts/_elevenlabs-config-loader.mjs.',
    );
  }
  if (cfg.ALLOWED_ORIGINS.length === 0) {
    throw new Error(`No ALLOWED_ORIGINS found in ${CONFIG_PATH}`);
  }
  return cfg;
}
