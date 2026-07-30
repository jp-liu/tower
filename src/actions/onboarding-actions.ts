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
  const log = logger.create("task-completion");
  try {
    log.info("Task completion event dispatched", {
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
      status: payload.status,
      executionId: payload.executionId,
    });

    // Broadcast via WebSocket to all notification clients
    const { broadcastNotification } = await import("@/lib/pty/ws-server");
    broadcastNotification({ ...payload, type: "completion" });

    // Done/failed is no longer auto-recorded by the backend: unattended is a run-time state the
    // agent enters via the tower-goal skill, which the backend can't infer. Pushing the result on
    // done/failure is the goal-activated agent's own job (tower-ask + ask_human park). The onExit
    // guard also keeps a parked task from ever reaching here.
  } catch {
    // Best-effort: notifications are non-critical
  }

  // Provider-neutral parent coordination is durable and separate from the
  // best-effort browser notification above. COMPLETED is a fallback for CLIs
  // without Stop hooks; the execution review guard suppresses it when a Stop
  // event already exists. FAILED always remains a distinct high-priority event.
  try {
    const { enqueueChildExecutionResult } = await import("@/lib/workbench/coordinator");
    await enqueueChildExecutionResult({
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
      executionId: payload.executionId,
      status: payload.status,
    });
  } catch (error) {
    log.error("Durable Workbench completion enqueue failed; startup recovery will retry", error, {
      taskId: payload.taskId,
      executionId: payload.executionId,
      status: payload.status,
    });
  }
}
