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

// D-04: globalThis singleton — survives HMR/module re-evaluation in Next.js dev mode.
const g = globalThis as typeof globalThis & { __taskCompletionQueue?: TaskCompletionPayload[] };

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

    // Push to globalThis queue for polling API route (Plan 01)
    if (!g.__taskCompletionQueue) g.__taskCompletionQueue = [];
    g.__taskCompletionQueue.push(payload);
    // Cap queue at 50 entries — splice oldest if exceeded
    if (g.__taskCompletionQueue.length > 50) {
      g.__taskCompletionQueue.splice(0, g.__taskCompletionQueue.length - 50);
    }
  } catch {
    // Best-effort: swallow errors silently
  }
}
