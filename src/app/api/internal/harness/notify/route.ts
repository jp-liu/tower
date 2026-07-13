import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { recordHarnessMessage } from "@/lib/harness/harness-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * notify_human 桥：非阻塞进度汇报。不 park、不结束回合 —— agent 继续跑。
 * Tower 只**记一条日志行**（供 /harness 面板可见）；真正外推给人由 agent 用平台 MCP 完成。
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { taskId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, message } = body;
  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const idErr = validateTaskId(taskId);
  if (idErr) return idErr;
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const { messageId } = await recordHarnessMessage({
    taskId,
    kind: "notify",
    content: message,
  });

  return NextResponse.json({ ok: true, messageId });
}
