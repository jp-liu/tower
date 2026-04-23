"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

export interface OnboardingStatus {
  isFirstRun: boolean;
  isCompleted: boolean;
  lastStep: number;
}

export interface TaskCompletionPayload {
  taskId: string;
  taskTitle: string;
  status: "COMPLETED" | "FAILED";
  executionId: string;
}

const ONBOARDING_KEYS = ["onboarding.completed", "onboarding.lastStep"] as const;

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

  return {
    isFirstRun: !isCompleted,
    isCompleted,
    lastStep,
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
    await db.systemConfig.upsert({
      where: { key: "onboarding.username" },
      create: { key: "onboarding.username", value: JSON.stringify(username) },
      update: { value: JSON.stringify(username) },
    });
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
  } catch {
    // Best-effort: swallow errors silently
  }
}
