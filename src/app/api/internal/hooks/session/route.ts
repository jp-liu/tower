export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";

/**
 * POST /api/internal/hooks/session
 *
 * Accepts { taskId, sessionId } from the PostToolUse hook.
 * Stores sessionId on the RUNNING execution for this task.
 * Idempotent — skips if sessionId already set.
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { taskId?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, sessionId } = body;

  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
  }
  const taskIdError = validateTaskId(taskId);
  if (taskIdError) return taskIdError;

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Find the RUNNING execution for this task
  const execution = await db.taskExecution.findFirst({
    where: { taskId, status: "RUNNING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, sessionId: true },
  });

  if (!execution) {
    return NextResponse.json({ error: "No running execution" }, { status: 404 });
  }

  // Skip if already set (idempotent)
  if (execution.sessionId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  await db.taskExecution.update({
    where: { id: execution.id },
    data: { sessionId },
  });

  return NextResponse.json({ ok: true, sessionId });
}
