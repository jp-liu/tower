import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { createAskMessage } from "@/lib/harness/harness-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ask_human bridge: record an ask(OPEN) + set the RUNNING execution to PAUSED (park).
 * Tower **records only, never sends** — actually pushing the question to a human is done by the
 * agent via the tower-ask skill using a platform MCP.
 * MCP is a separate stdio process with no access to Next's in-memory DB/PTY, so it goes through this
 * in-process bridge (same as terminal-tools).
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { taskId?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, question } = body;
  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const idErr = validateTaskId(taskId);
  if (idErr) return idErr;
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      unattended: true,
      executions: { where: { status: "RUNNING" }, select: { id: true }, take: 1 },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Record ask(OPEN) + park (one-pending: internally cancels any prior OPEN ask first). Tower does not send —
  // the agent pushes the question out via the tower-ask skill using a platform MCP; either way this OPEN ask is visible and answerable in the /harness panel.
  const { messageId } = await createAskMessage({
    taskId,
    executionId: task.executions[0]?.id ?? null,
    question,
  });

  // No notify channel configured → prompt the agent to guide the user to the settings page (the question stays visible/answerable in the /harness panel).
  const { readConfigValue } = await import("@/lib/config-reader");
  const targets = await readConfigValue<unknown[]>("harness.targets", []);
  const noChannelConfigured = !Array.isArray(targets) || targets.length === 0;

  return NextResponse.json({ ok: true, requestId: messageId, noChannelConfigured });
}
