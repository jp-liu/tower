import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start (launch) a task's PTY terminal, defaulting to resuming the latest
 * history session (the Continue/Retry button). Mirrors `continueOrStartTaskExecution`:
 * already-running is a no-op, history → continue latest, no history → fresh start.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { taskId } = await params;
  const idError = validateTaskId(taskId);
  if (idError) return idError;

  try {
    const result = await continueOrStartTaskExecution(taskId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
