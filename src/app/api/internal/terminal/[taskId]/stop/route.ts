import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { getSession } from "@/lib/pty/session-store";
import { stopPtyExecution } from "@/actions/agent-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stop (close) a task's PTY terminal session. Mirrors the Stop button:
 * reuses `stopPtyExecution`, which kills the process group, finalizes the
 * RUNNING execution, and transitions the task to IN_REVIEW.
 *
 * If no session is active this is a no-op and still returns ok. `wasRunning`
 * reports whether a live (non-exited) session existed before the call so MCP
 * callers can phrase their result accurately.
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
    const session = getSession(taskId);
    const wasRunning = !!session && !session.killed;
    await stopPtyExecution(taskId);
    return NextResponse.json({ ok: true, wasRunning });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
