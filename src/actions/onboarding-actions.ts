"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

export interface OnboardingStatus {
  isFirstRun: boolean;
  isCompleted: boolean;
  lastStep: number;
  username: string | null;
}

export interface TaskCompletionPayload {
  taskId: string;
  taskTitle: string;
  status: "COMPLETED" | "FAILED";
  executionId: string;
  workspaceId: string;
}

const ONBOARDING_KEYS = ["onboarding.completed", "onboarding.lastStep", "onboarding.username"] as const;

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const rows = await db.systemConfig.findMany({
    where: { key: { in: [...ONBOARDING_KEYS] } },
  });

  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      stored[row.key] = null;
    }
  }

  const isCompleted = stored["onboarding.completed"] === true;
  const rawStep = stored["onboarding.lastStep"];
  const lastStep = typeof rawStep === "number" ? rawStep : 0;
  const rawUsername = stored["onboarding.username"];
  const username = typeof rawUsername === "string" && rawUsername.length > 0 ? rawUsername : null;

  return {
    isFirstRun: !isCompleted,
    isCompleted,
    lastStep,
    username,
  };
}

export async function setOnboardingProgress(step: number): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: "onboarding.lastStep" },
    create: { key: "onboarding.lastStep", value: JSON.stringify(step) },
    update: { value: JSON.stringify(step) },
  });
  revalidatePath("/", "layout");
}

export async function completeOnboarding(username?: string, lastStep: number = 4): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: "onboarding.completed" },
    create: { key: "onboarding.completed", value: "true" },
    update: { value: "true" },
  });
  await db.systemConfig.upsert({
    where: { key: "onboarding.lastStep" },
    create: { key: "onboarding.lastStep", value: String(lastStep) },
    update: { value: String(lastStep) },
  });
  if (username !== undefined) {
    const sanitized = username.trim().slice(0, 64).replace(/[\r\n]/g, " ");
    if (sanitized.length > 0) {
      await db.systemConfig.upsert({
        where: { key: "onboarding.username" },
        create: { key: "onboarding.username", value: JSON.stringify(sanitized) },
        update: { value: JSON.stringify(sanitized) },
      });
    }
  }

  revalidatePath("/", "layout");
}

export async function setOnboardingExtensions(
  requested: string[],
  completed: string[]
): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: "onboarding.extensions.requested" },
    create: { key: "onboarding.extensions.requested", value: JSON.stringify(requested) },
    update: { value: JSON.stringify(requested) },
  });
  await db.systemConfig.upsert({
    where: { key: "onboarding.extensions.completed" },
    create: { key: "onboarding.extensions.completed", value: JSON.stringify(completed) },
    update: { value: JSON.stringify(completed) },
  });
  revalidatePath("/", "layout");
}

export async function dispatchTaskCompletionEvent(
  payload: TaskCompletionPayload
): Promise<void> {
  try {
    const log = logger.create("task-completion");
    log.info("Task completion event dispatched", {
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
      status: payload.status,
      executionId: payload.executionId,
    });

    // Broadcast via WebSocket to all notification clients
    const { broadcastNotification } = await import("@/lib/pty/ws-server");
    broadcastNotification({ ...payload, type: "completion" });

    // Harness done/failed 回执：任务自然结束（非 park —— park 时 execution 是 PAUSED，
    // onExit guard 早退，根本到不了这里）。无人值守且有 notify 绑定时推一条完成/失败回执。
    void (async () => {
      try {
        const { db } = await import("@/lib/db");
        const { notifyForTask } = await import("@/lib/harness/notify/dispatch");
        const task = await db.task.findUnique({
          where: { id: payload.taskId },
          select: { unattended: true },
        });
        if (!task?.unattended) return;
        const isDone = payload.status === "COMPLETED";
        await notifyForTask({
          taskId: payload.taskId,
          unattended: true,
          kind: isDone ? "done" : "failed",
          title: payload.taskTitle,
          body: isDone ? "任务已完成，进入待审阅。" : "任务执行失败，请查看终端。",
          correlationId: payload.executionId,
        });
      } catch {
        // Best-effort — 回执失败不影响主流程
      }
    })();
  } catch {
    // Best-effort: notifications are non-critical
  }
}
