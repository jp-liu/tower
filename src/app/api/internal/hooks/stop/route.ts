import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stop event queue — receives events from Claude's Stop hook
 * when Claude finishes responding to a message.
 * Consumed by the notification pending API.
 */
const g = globalThis as typeof globalThis & {
  __stopEventQueue?: StopEvent[];
};
if (!g.__stopEventQueue) g.__stopEventQueue = [];

export interface StopEvent {
  taskId: string;
  taskTitle: string;
  sessionId: string;
  workspaceId: string;
  type: "stop";
  timestamp: string;
}

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
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  // Look up task to get title and workspaceId
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      project: { select: { workspaceId: true } },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const event: StopEvent = {
    taskId: task.id,
    taskTitle: task.title,
    sessionId: sessionId ?? "",
    workspaceId: task.project.workspaceId,
    type: "stop",
    timestamp: new Date().toISOString(),
  };

  g.__stopEventQueue!.push(event);
  // Cap queue at 50
  if (g.__stopEventQueue!.length > 50) {
    g.__stopEventQueue = g.__stopEventQueue!.slice(-50);
  }

  return NextResponse.json({ ok: true });
}
