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

  try {
    await startAssistantSession();
    return NextResponse.json({ ok: true, sessionKey: ASSISTANT_SESSION_KEY });
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
