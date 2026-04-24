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

export async function completeOnboarding(username?: string): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: "onboarding.completed" },
    create: { key: "onboarding.completed", value: "true" },
    update: { value: "true" },
  });
  await db.systemConfig.upsert({
    where: { key: "onboarding.lastStep" },
    create: { key: "onboarding.lastStep", value: "2" },
    update: { value: "2" },
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
  } catch {
    // Best-effort: notifications are non-critical
  }
}
