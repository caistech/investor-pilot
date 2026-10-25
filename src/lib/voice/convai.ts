// The InvestorPilot voice agent, with the portfolio memory loop behind it.
//
// What was here before: `@elevenlabs/convai-widget-embed` pointed at one help agent id, with no
// webhook routes, no memory tables and no per-user identity — so the agent could not remember a
// user between calls, and nothing asserted that it could. This is the shape every other voice
// product in the portfolio now uses: @caistech/elevenlabs-convai's webhook routes, one agent per
// user, memory scoped to the user.
//
// WHY ONE AGENT PER USER. ElevenLabs never passes the conversation id to a server-tool webhook — the
// agent sends only the LLM-filled params — so a recall tool receiving `{query}` alone cannot bind a
// conversation, and recall fails with "Conversation not found" while the call sounds fine. Identity
// is therefore fixed at PROVISION time and baked into the tool URL as `?uid=…`.
//
// Mirrors F2K-Checkpoint's src/lib/voice/convai.ts deliberately (the build-alike rule): same
// construction order, same fail-closed posture, so a future extraction is a lift rather than a
// rewrite.

import {
  createConvaiWebhookRoutes,
  CONVAI_TOOL_SECRET_HEADER,
  type ConvaiWebhookRoutes,
  type ConvaiToolIdentity,
} from "@caistech/elevenlabs-convai";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Where the routes below are mounted, and what the agent's tool URLs are built from. */
export const CONVAI_WEBHOOK_BASE_PATH = "/api/convai/webhooks";

let cachedRoutes: ConvaiWebhookRoutes | null = null;

/**
 * Built lazily. `createServiceClient()` reads SUPABASE_SERVICE_ROLE_KEY, and a module-scope call
 * would run during `next build` page-data collection — a build has no runtime secrets and must not
 * need them. That failure mode has already cost this portfolio a red build once.
 */
export function investorPilotConvaiRoutes(): ConvaiWebhookRoutes {
  if (cachedRoutes) return cachedRoutes;

  cachedRoutes = createConvaiWebhookRoutes({
    supabase: createServiceClient(),

    // HMAC on every post-call payload. Unset is a REFUSAL, not a skip: the post-call handler binds
    // by agent id and conversation id taken from the BODY, and the agent id ships to the browser, so
    // an unsigned payload could write conversation content the agent later recalls and speaks back
    // as fact. (Package ≥0.10.0 fails closed; passing it explicitly keeps the intent visible here.)
    postCallSecret: process.env.ELEVENLABS_WEBHOOK_SECRET,

    /**
     * Start path — TWO legitimate callers that cannot share one mechanism.
     *
     * The browser opens a session with a cookie. ElevenLabs' server also calls this as the
     * `start_conversation` tool with no cookie at all; a cookie-only implementation returns 401 to
     * the platform, and the agent then opens every call with "first chat here" even for a user it
     * has months of memory for. (F2K-Checkpoint found this via portfolio-gate-memory-loop, not by
     * reading.)
     *
     * The server-to-server path is accepted via the `?uid=` baked into the tool URL at provision
     * time — but ONLY when the request carries the tool secret. Without that condition anyone who
     * can guess a user id could open that user's conversation context, and a uid is not secret.
     */
    resolveSession: async (req: Request) => {
      const toolSecret = process.env.CONVAI_TOOL_SECRET;
      const presented = req.headers.get(CONVAI_TOOL_SECRET_HEADER);
      if (toolSecret && presented && presented === toolSecret) {
        const uid = new URL(req.url).searchParams.get("uid")?.trim();
        if (uid) return { userId: uid };
      }

      // Browser path: identity from the session, never from anything the client says.
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Null rejects with 401. InvestorPilot has no anonymous voice surface — the help agent lives
      // inside the authed app — so there is no anonSessionId branch to write.
      return user ? { userId: user.id } : null;
    },

    /**
     * Memory-tool path — identity from the `?uid=` baked into the tool URL at provision time.
     *
     * This cannot fall back to "whoever is logged in": the caller is ElevenLabs' server, not the
     * user's browser, so there is no session to read. The tool secret below is what stops an
     * arbitrary caller naming someone else's uid.
     */
    resolveToolIdentity: (req: Request): ConvaiToolIdentity | null => {
      const uid = new URL(req.url).searchParams.get("uid")?.trim();
      // agentId intentionally omitted: null scopes recall to the whole user rather than one agent,
      // which is what the one-agent-per-user shape wants.
      return uid ? { userId: uid } : null;
    },

    // Header `x-convai-tool-secret` on every memory-tool call. Without it, identity is derived from
    // a PUBLIC agent id and anyone could POST recall/save against another user.
    toolSecret: process.env.CONVAI_TOOL_SECRET,
  });

  return cachedRoutes;
}
