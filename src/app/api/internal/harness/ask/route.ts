import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { createAskMessage } from "@/lib/harness/harness-message";
import { dispatchHarnessMessage } from "@/lib/harness/notify/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ask_human 桥：落一条 PENDING、把 RUNNING execution 置 PAUSED（park），
 * 并在无人值守下把问题推到操作者渠道。MCP 是独立 stdio 进程，拿不到 Next 内存里的
 * DB/PTY/渠道，所以走这个进程内桥（与 terminal-tools 一致）。
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
      title: true,
      unattended: true,
      executions: { where: { status: "RUNNING" }, select: { id: true }, take: 1 },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // 先记录 ask(OPEN) + park（one-pending：内部会先取消旧 OPEN ask）。记录先于发送。
  const { messageId } = await createAskMessage({
    taskId,
    executionId: task.executions[0]?.id ?? null,
    question,
  });

  // 通知只在无人值守时外推；非无人值守仅记录（UI 可见），人经通知中心/UI 回复。
  // dispatch 全 best-effort：发送成败都不影响已记录的 park。
  const { notified } = await dispatchHarnessMessage({
    messageId,
    taskId,
    unattended: task.unattended,
    kind: "ask",
    title: task.title,
    body: question,
  });

  return NextResponse.json({ ok: true, requestId: messageId, notified });
}
