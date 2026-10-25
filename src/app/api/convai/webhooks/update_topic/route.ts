// POST {CONVAI_WEBHOOK_BASE_PATH}/update_topic — rename the conversation from its content.
//
// @machine-callable — called by ElevenLabs' servers, never by a browser. /api/* is outside this
// app's protected prefixes; keep it that way, because a session redirect to /login is followed to
// an HTML page, throws nothing and logs nothing, and the memory loop then simply never runs.

import { investorPilotConvaiRoutes } from "@/lib/voice/convai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return investorPilotConvaiRoutes().updateTopic(request);
}
