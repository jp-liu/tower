import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { broadcastNotification } from "@/lib/pty/ws-server";
import { notifyParentOnChildDecision, notifyParentOnChildStop } from "@/lib/derive/notify-parent";
import { getOpenAsk } from "@/lib/harness/harness-message";
import { notifyPtyProviderTurnCompleted } from "@/lib/pty/lifecycle";
import { destroySession, markSessionTurnComplete } from "@/lib/pty/session-store";

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

  let body: { taskId?: string; executionId?: string; sessionId?: string; eventId?: string; lastReply?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, executionId, sessionId, eventId, lastReply } = body;
  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  // Look up task to get title and workspaceId
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      parentTaskId: true,
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

  const [execution, currentProviderExecution] = await Promise.all([
    db.taskExecution.findFirst({
      where: {
        taskId: task.id,
        ...(executionId
          ? { id: executionId }
          : sessionId
            ? { sessionId }
            : { status: "RUNNING" as const }),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
    db.taskExecution.findFirst({
      where: { taskId: task.id, status: { in: ["RUNNING", "PAUSED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);
  if (executionId && !execution) {
    return NextResponse.json({ error: "Execution does not belong to task" }, { status: 409 });
  }
  const ownsCurrentProviderTurn = Boolean(
    execution
    && (execution.status === "RUNNING" || execution.status === "PAUSED")
    && currentProviderExecution?.id === execution.id,
  );
  const childContext = { sessionId, eventId, executionId: execution?.id ?? null };

  // This provider callback is the authoritative end-of-turn signal. Keep that
  // fact on the live PTY object so a later startup/module recovery can restore
  // a lost drain token without treating a busy terminal as safe. Fence by the
  // current execution so a delayed durable record cannot unlock a newer PTY.
  if (ownsCurrentProviderTurn) {
    markSessionTurnComplete(task.id);
    broadcastNotification(event);
  }

  // Harness park 分叉：这次回合结束若是「等人回复」（有 PENDING 请求）而非「做完」，
  // 就 kill 掉空闲 PTY 省资源即返回。execution 已在 ask_human 时置 PAUSED → onExit guard
  // 会跳过 finalize / IN_REVIEW，保留 sessionId 供 resume；且不回推父任务（不是完成事件）。
  const pending = ownsCurrentProviderTurn ? await getOpenAsk(task.id) : null;
  if (pending) {
    await notifyParentOnChildDecision(
      task.id,
      task.title,
      lastReply ?? "",
      pending.content,
      childContext,
    );
    destroySession(task.id);
    return NextResponse.json({ ok: true, parked: true });
  }

  // An open ask deliberately parks instead of admitting autonomous input. Once
  // that guard is clear, publish the provider boundary to interested modules.
  if (ownsCurrentProviderTurn) {
    if (eventId) {
      await notifyPtyProviderTurnCompleted(task.id, `${execution?.id ?? task.id}:${eventId}`);
    } else {
      await notifyPtyProviderTurnCompleted(task.id);
    }
  }

  // Codex's agent-turn-complete notify is the authoritative terminal event for
  // derived one-shot work. Persist the terminal state before publishing review
  // so a PTY exit race or server restart cannot leave RUNNING behind.
  const authoritativeLateCompletion = execution?.status === "FAILED" && executionId && eventId;
  if (task.parentTaskId && execution && (ownsCurrentProviderTurn || authoritativeLateCompletion)) {
    await db.$transaction([
      db.taskExecution.updateMany({
        where: {
          id: execution.id,
          OR: [
            { status: "RUNNING" },
            // Startup conservatively marks orphaned PTYs FAILED. A later
            // provider event with both stable ids is stronger evidence.
            { status: "FAILED", exitCode: null },
          ],
        },
        data: {
          status: "COMPLETED",
          endedAt: new Date(),
          exitCode: 0,
          summary: lastReply?.trim().slice(0, 8000) || undefined,
        },
      }),
      db.task.updateMany({
        where: {
          id: task.id,
          status: "IN_PROGRESS",
          executions: {
            none: {
              status: { in: ["RUNNING", "PAUSED"] },
              id: { not: execution.id },
            },
          },
        },
        data: { status: "IN_REVIEW" },
      }),
    ]);
  }

  if (task.parentTaskId && execution && executionId && eventId) {
    await db.workbenchEvent.updateMany({
      where: {
        executionId: execution.id,
        kind: "CHILD_EXECUTION_FAILED",
        state: { in: ["PENDING", "PROCESSING"] },
      },
      data: {
        state: "CONSUMED",
        claimToken: null,
        claimedAt: null,
        consumedAt: new Date(),
      },
    });
  }

  // Fan-out 消费者 2（派生中枢）：子任务事件只做去重持久化。父终端是否运行
  // 不影响入库；实际 review batch 由父任务自己的安全回合边界统一 drain。
  await notifyParentOnChildStop(task.id, task.title, lastReply ?? "", childContext);

  if (task.parentTaskId && ownsCurrentProviderTurn) destroySession(task.id);

  return NextResponse.json({ ok: true });
}
