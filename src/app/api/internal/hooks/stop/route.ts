import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { broadcastNotification } from "@/lib/pty/ws-server";
import { notifyParentOnChildStop } from "@/lib/derive/notify-parent";
import { getOpenAsk } from "@/lib/harness/harness-message";
import { destroySession } from "@/lib/pty/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface StopEvent {
  taskId: string;
  taskTitle: string;
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  projectName: string;
  type: "stop";
  timestamp: string;
}

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { taskId?: string; sessionId?: string; lastReply?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, sessionId, lastReply } = body;
  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  // Look up task to get title and workspaceId
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      project: {
        select: {
          name: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
      },
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
    workspaceName: task.project.workspace.name,
    projectName: task.project.name,
    type: "stop",
    timestamp: new Date().toISOString(),
  };

  // Fan-out 消费者 1：推给所有通知 WS 客户端（浏览器 UI 的「回合完成」指示）。
  broadcastNotification(event);

  // Harness park 分叉：这次回合结束若是「等人回复」（有 PENDING 请求）而非「做完」，
  // 就 kill 掉空闲 PTY 省资源即返回。execution 已在 ask_human 时置 PAUSED → onExit guard
  // 会跳过 finalize / IN_REVIEW，保留 sessionId 供 resume；且不回推父任务（不是完成事件）。
  const pending = await getOpenAsk(task.id);
  if (pending) {
    destroySession(task.id);
    return NextResponse.json({ ok: true, parked: true });
  }

  // Fan-out 消费者 2（派生中枢）：若本任务是某父任务派生的子任务、且父任务终端仍在跑，
  // 把一段 review 引导 prompt 写进父任务 PTY 唤醒它。best-effort，与浏览器通知互不拖累。
  await notifyParentOnChildStop(task.id, task.title, lastReply ?? "");

  return NextResponse.json({ ok: true });
}
