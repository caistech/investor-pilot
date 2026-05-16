'use client';

import Script from 'next/script';

/**
 * Floating ElevenLabs ConvAI voice-help widget. Positioned via the agent's
 * platform_settings.widget.placement field (set to 'top-right' in
 * src/lib/elevenlabs/agent-config.ts — the widget self-positions via fixed
 * positioning on its own shadow root, so wrapping it in a positioned div
 * has no effect). Non-blocking — does not steal focus until the user clicks
 * it.
 *
 * Renders nothing if NEXT_PUBLIC_ELEVENLABS_AGENT_ID is unset, so dev/preview
 * environments without the agent configured stay clean.
 */
export function ElevenLabsWidget() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!agentId) return null;

  return (
    <>
      <elevenlabs-convai agent-id={agentId} />
      <Script
        src="https://unpkg.com/@elevenlabs/convai-widget-embed"
        strategy="afterInteractive"
        async
        type="text/javascript"
      />
    </>
  );
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'elevenlabs-convai': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { 'agent-id': string },
        HTMLElement
      >;
    }
  }
}
