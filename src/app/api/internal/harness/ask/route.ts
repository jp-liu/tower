import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { createAskMessage } from "@/lib/harness/harness-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ask_human 桥：记一条 ask(OPEN) + 把 RUNNING execution 置 PAUSED（park）。
 * Tower **只记录不发送** —— 真正把问题推给人由 agent 经 tower-ask 技能用平台 MCP 完成。
 * MCP 是独立 stdio 进程，拿不到 Next 内存里的 DB/PTY，所以走这个进程内桥（与 terminal-tools 一致）。
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

  // 记录 ask(OPEN) + park（one-pending：内部会先取消旧 OPEN ask）。Tower 不发送 ——
  // 问题外推由 agent 经 tower-ask 技能用平台 MCP 完成；无论如何这条 OPEN ask 在 /harness 面板可见、可回复。
  const { messageId } = await createAskMessage({
    taskId,
    executionId: task.executions[0]?.id ?? null,
    question,
  });

  // ask_human = 找本人拍板 = unattended 语义。防呆：没有「生效的 unattended 渠道」就报
  // noChannelConfigured —— 只配了 work 渠道时也算未配，否则 park 了却推不到本人、没人收到。
  const { readConfigValue } = await import("@/lib/config-reader");
  const targets = await readConfigValue<Array<{ active?: boolean; gateway?: string; scope?: string }>>(
    "harness.targets",
    []
  );
  const noChannelConfigured = !(
    Array.isArray(targets) &&
    targets.some((t) => t?.active && t?.gateway && (t.scope ?? "unattended") === "unattended")
  );

  return NextResponse.json({ ok: true, requestId: messageId, noChannelConfigured });
}
