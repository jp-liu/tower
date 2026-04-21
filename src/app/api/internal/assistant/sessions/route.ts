import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { ensureTowerDir } from "@/lib/init-tower";
import {
  convertSessionMessages,
  type SDKSessionMessage,
} from "@/lib/assistant-message-converter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/internal/assistant/sessions?sessionId=xxx
 *
 * Returns messages for a specific session from the SDK.
 * Session list is managed client-side via localStorage registry
 * to avoid cross-project session leakage from SDK's listSessions.
 */
export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const towerDir = ensureTowerDir();

  try {
    const { getSessionMessages } = await import(
      "@anthropic-ai/claude-agent-sdk"
    );
    const sdkMessages = (await getSessionMessages(sessionId, {
      dir: towerDir,
    })) as SDKSessionMessage[];
    const chatMessages = convertSessionMessages(sdkMessages);
    return NextResponse.json({ messages: chatMessages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[assistant-sessions] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
