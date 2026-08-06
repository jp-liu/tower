import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { createAskMessage } from "@/lib/harness/harness-message";
import { parkSession } from "@/lib/pty/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ask_human bridge: record an ask(OPEN) + set the RUNNING execution to PAUSED (park).
 * This route records only. Outbound delivery uses tower-bridge's push_to_human
 * durable outbox path before this record/park operation is activated.
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
      executions: { where: { status: "RUNNING" }, select: { id: true }, take: 1 },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Record ask(OPEN) + park (one-pending: internally cancels any prior OPEN ask first). Tower does not send —
  // the agent pushes the question out via the tower-bridge message path; either way this OPEN ask is visible and answerable in the /harness panel.
  const { messageId } = await createAskMessage({
    taskId,
    executionId: task.executions[0]?.id ?? null,
    question,
  });

  // Keep the live PTY alive across the human wait: suspend the WS-disconnect
  // keepalive so the reply lands in this same session (already_running injection)
  // instead of a fragile resume/--continue restart. No-op if no live session.
  parkSession(taskId);

  // ask_human means "reach the owner to decide" = unattended semantics. Backstop: report
  // noChannelConfigured unless an ACTIVE unattended channel exists — a work-only config also
  // counts as unconfigured, else the task parks but nobody can be reached.
  const { readConfigValue } = await import("@/lib/config-reader");
  const targets = await readConfigValue<Array<{ active?: boolean; gateway?: string; scope?: string; dest?: string }>>(
    "harness.targets",
    []
  );
  const noChannelConfigured = !(
    Array.isArray(targets) &&
    targets.some((t) => {
      if (!t?.active || !t?.gateway || (t.scope ?? "unattended") !== "unattended") return false;
      if (t.gateway === "hermes") return true;
      return true;
    })
  );

  return NextResponse.json({ ok: true, requestId: messageId, noChannelConfigured });
}
