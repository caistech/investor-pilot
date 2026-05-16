'use client';

import Script from 'next/script';

/**
 * Floating ElevenLabs ConvAI voice-help widget. Positioned in the top-right
 * corner of every dashboard page via the dashboard layout. Non-blocking —
 * it sits over content but the widget itself ships its own bubble UI that
 * does not steal focus until the user clicks it.
 *
 * Renders nothing if NEXT_PUBLIC_ELEVENLABS_AGENT_ID is unset, so dev/preview
 * environments without the agent configured stay clean.
 */
export function ElevenLabsWidget() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!agentId) return null;

  return (
    <>
      <div className="fixed top-4 right-4 z-50 pointer-events-auto">
        {/* The convai-widget custom element is rendered by the script below. */}
        <elevenlabs-convai agent-id={agentId} />
      </div>
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
