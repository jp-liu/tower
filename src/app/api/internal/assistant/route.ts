import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import {
  startAssistantSession,
  stopAssistantSession,
  getAssistantSessionStatus,
} from "@/actions/assistant-actions";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let sessionId: string | undefined;
  try {
    const body = await request.json().catch(() => ({})) as { sessionId?: string };
    if (body.sessionId && typeof body.sessionId === "string") {
      sessionId = body.sessionId;
    }
  } catch {
    // No body or invalid JSON — treat as new session
  }

  try {
    await startAssistantSession(sessionId);
    return NextResponse.json({ ok: true, sessionKey: ASSISTANT_SESSION_KEY, sessionId: sessionId ?? null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  await stopAssistantSession();
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const status = await getAssistantSessionStatus();
  return NextResponse.json({ status });
}
