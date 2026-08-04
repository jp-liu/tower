import { randomUUID } from "node:crypto";
import type { PrismaClient, UnattendedGoalRuntime } from "@prisma/client";
import { db } from "@/lib/db";
import { persistWorkbenchCommand } from "@/lib/workbench/event-contract";
import { setUnattendedSignal } from "@/lib/harness/unattended-signal";
import { TurnTimeBudgetGuard } from "./budget";

export type GoalPolicyDb = Pick<
  PrismaClient,
  | "task"
  | "taskExecution"
  | "capabilityRequest"
  | "capabilityGrant"
  | "harnessMessage"
  | "workbenchEvent"
  | "workbenchBatch"
  | "unattendedGoalRuntime"
  | "unattendedGoalProgressFact"
  | "$transaction"
>;

export type GoalProgressFactKind =
  | "PROVIDER_TURN_COMPLETED"
  | "CHILD_SUCCEEDED"
  | "CHILD_FAILED"
  | "CAPABILITY_JOB_SUCCEEDED"
  | "CAPABILITY_JOB_FAILED";

export type GoalBudgetReason =
  | "MAX_DURATION"
  | "MAX_PROVIDER_TURNS"
  | "MAX_CHILD_TASKS"
  | "MAX_CONCURRENT_CHILDREN"
  | "MAX_CONSECUTIVE_FAILURES"
  | "MAX_NO_PROGRESS_TURNS"
  | "MAX_CAPABILITY_JOBS"
  | "MAX_TOKENS"
  | "MAX_COST";

export interface GoalBudgetSnapshot {
  elapsedMs: number;
  providerTurns: number;
  childTasks: number;
  concurrentChildren: number;
  consecutiveFailures: number;
  noProgressTurns: number;
  capabilityJobs: number;
  activeCapabilityJobs: number;
  openAsks: number;
  activeWorkbenchLeases: number;
  consumedTokens: number | null;
  consumedCostUsdCents: number | null;
}

export type GoalBudgetVerdict =
  | { ok: true; snapshot: GoalBudgetSnapshot }
  | { ok: false; reason: GoalBudgetReason; detail: string; snapshot: GoalBudgetSnapshot };

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function readActiveRuntime(taskId: string, database: GoalPolicyDb) {
  return database.unattendedGoalRuntime.findUnique({ where: { taskId } });
}

export async function readUnattendedGoalBudget(
  taskId: string,
  database: GoalPolicyDb = db,
  now = new Date(),
): Promise<{ runtime: UnattendedGoalRuntime; snapshot: GoalBudgetSnapshot } | null> {
  const runtime = await readActiveRuntime(taskId, database);
  if (!runtime || runtime.state !== "ACTIVE") return null;
  const since = runtime.activatedAt;
  const [childTasks, concurrentChildren, capabilityJobs, activeCapabilityJobs, openAsks, activeWorkbenchLeases] =
    await Promise.all([
      database.task.count({ where: { parentTaskId: taskId, createdAt: { gte: since } } }),
      database.taskExecution.count({
        where: { task: { parentTaskId: taskId }, status: "RUNNING", createdAt: { gte: since } },
      }),
      database.capabilityRequest.count({
        where: { taskId, lane: "JOB", createdAt: { gte: since } },
      }),
      database.capabilityRequest.count({
        where: { taskId, lane: "JOB", state: { in: ["PENDING", "ACCEPTED", "RUNNING"] }, createdAt: { gte: since } },
      }),
      database.harnessMessage.count({ where: { taskId, kind: "ask", state: "OPEN" } }),
      database.workbenchBatch.count({
        where: {
          parentTaskId: taskId,
          state: { in: ["CLAIMED", "DISPATCHED", "ACKED"] },
          leaseExpiresAt: { gt: now },
        },
      }),
    ]);
  return {
    runtime,
    snapshot: {
      elapsedMs: Math.max(0, now.getTime() - runtime.activatedAt.getTime()),
      providerTurns: runtime.providerTurns,
      childTasks,
      concurrentChildren,
      consecutiveFailures: runtime.consecutiveFailures,
      noProgressTurns: runtime.noProgressTurns,
      capabilityJobs,
      activeCapabilityJobs,
      openAsks,
      activeWorkbenchLeases,
      consumedTokens: runtime.consumedTokens,
      consumedCostUsdCents: runtime.consumedCostUsdCents,
    },
  };
}

function evaluateRuntimeBudget(runtime: UnattendedGoalRuntime, snapshot: GoalBudgetSnapshot): GoalBudgetVerdict {
  const base = new TurnTimeBudgetGuard({
    maxTurns: runtime.maxProviderTurns,
    maxDurationMs: runtime.maxDurationMs,
  }).check({ turns: snapshot.providerTurns, elapsedMs: snapshot.elapsedMs });
  if (!base.ok) {
    return {
      ok: false,
      reason: base.reason === "max_turns" ? "MAX_PROVIDER_TURNS" : "MAX_DURATION",
      detail: base.detail,
      snapshot,
    };
  }
  if (snapshot.concurrentChildren > runtime.maxConcurrentChildren) {
    return { ok: false, reason: "MAX_CONCURRENT_CHILDREN", detail: `Concurrent child executions ${snapshot.concurrentChildren} exceed limit ${runtime.maxConcurrentChildren}`, snapshot };
  }
  if (snapshot.childTasks > runtime.maxChildTasks) {
    return { ok: false, reason: "MAX_CHILD_TASKS", detail: `Child task count ${snapshot.childTasks} exceeds limit ${runtime.maxChildTasks}`, snapshot };
  }
  if (snapshot.consecutiveFailures >= runtime.maxConsecutiveFailures) {
    return { ok: false, reason: "MAX_CONSECUTIVE_FAILURES", detail: `Consecutive failure count ${snapshot.consecutiveFailures} reached limit ${runtime.maxConsecutiveFailures}`, snapshot };
  }
  if (snapshot.noProgressTurns >= runtime.maxNoProgressTurns) {
    return { ok: false, reason: "MAX_NO_PROGRESS_TURNS", detail: `Turns without a durable progress fact ${snapshot.noProgressTurns} reached limit ${runtime.maxNoProgressTurns}`, snapshot };
  }
  if (snapshot.capabilityJobs > runtime.maxCapabilityJobs) {
    return { ok: false, reason: "MAX_CAPABILITY_JOBS", detail: `External Job count ${snapshot.capabilityJobs} exceeds limit ${runtime.maxCapabilityJobs}`, snapshot };
  }
  if (
    runtime.maxTokens !== null
    && snapshot.consumedTokens !== null
    && snapshot.consumedTokens >= runtime.maxTokens
  ) {
    return { ok: false, reason: "MAX_TOKENS", detail: `Observed token usage ${snapshot.consumedTokens} reached limit ${runtime.maxTokens}`, snapshot };
  }
  if (
    runtime.maxCostUsdCents !== null
    && snapshot.consumedCostUsdCents !== null
    && snapshot.consumedCostUsdCents >= runtime.maxCostUsdCents
  ) {
    return { ok: false, reason: "MAX_COST", detail: `Observed cost ${snapshot.consumedCostUsdCents} cents reached limit ${runtime.maxCostUsdCents} cents`, snapshot };
  }
  return { ok: true, snapshot };
}

async function publishBlockedGoalIfNeeded(runtime: UnattendedGoalRuntime, database: GoalPolicyDb) {
  if (runtime.state !== "BLOCKED" || runtime.blockEventPublishedAt) return runtime;
  await database.$transaction(async (tx) => {
    const current = await tx.unattendedGoalRuntime.findUnique({ where: { taskId: runtime.taskId } });
    if (
      !current
      || current.state !== "BLOCKED"
      || current.blockGeneration !== runtime.blockGeneration
      || current.blockEventPublishedAt
    ) return;
    const task = await tx.task.findUnique({ where: { id: runtime.taskId }, select: { id: true, title: true } });
    if (!task) return;
    await persistWorkbenchCommand(tx, {
      parentTaskId: task.id,
      sourceTaskId: task.id,
      kind: "GOAL_BLOCKED",
      priority: "HIGH",
      dedupKey: `goal-blocked:${task.id}:${runtime.blockGeneration}`,
      payload: {
        childTaskId: task.id,
        childTitle: task.title,
        status: "BLOCKED",
        summary: current.blockedReason ?? "Unattended Goal budget or watchdog policy blocked execution",
      },
    });
    await tx.unattendedGoalRuntime.update({
      where: { taskId: task.id },
      data: { blockEventPublishedAt: new Date() },
    });
  });
  return database.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: runtime.taskId } });
}

async function blockGoal(
  taskId: string,
  verdict: Exclude<GoalBudgetVerdict, { ok: true }>,
  database: GoalPolicyDb,
): Promise<UnattendedGoalRuntime> {
  const blocked = await database.$transaction(async (tx) => {
    const runtime = await tx.unattendedGoalRuntime.findUnique({ where: { taskId } });
    if (!runtime || runtime.state !== "ACTIVE") return runtime;
    await tx.task.update({
      where: { id: taskId },
      data: { unattended: false },
      select: { id: true },
    });
    await tx.capabilityGrant.updateMany({
      where: { taskId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.unattendedGoalRuntime.update({
      where: { taskId },
      data: {
        state: "BLOCKED",
        lastEventKind: `BUDGET_${verdict.reason}`,
        blockedAt: new Date(),
        blockedReason: verdict.detail.slice(0, 2_000),
        nextWakeAt: null,
        wakeReason: null,
        blockGeneration: { increment: 1 },
        blockEventPublishedAt: null,
      },
    });
  });
  if (!blocked) throw new Error("Unattended Goal no longer exists");
  setUnattendedSignal(taskId, false);
  return publishBlockedGoalIfNeeded(blocked, database);
}

export async function enforceUnattendedGoalBudget(
  taskId: string,
  database: GoalPolicyDb = db,
  now = new Date(),
): Promise<GoalBudgetVerdict | null> {
  const current = await readUnattendedGoalBudget(taskId, database, now);
  if (!current) return null;
  const verdict = evaluateRuntimeBudget(current.runtime, current.snapshot);
  if (!verdict.ok) await blockGoal(taskId, verdict, database);
  return verdict;
}

export async function assertUnattendedGoalOperationAllowed(
  taskId: string,
  operation: "CREATE_CHILD" | "START_CHILD" | "CAPABILITY_JOB",
  database: GoalPolicyDb = db,
): Promise<void> {
  const runtime = await readActiveRuntime(taskId, database);
  if (runtime?.state === "BLOCKED") {
    throw new Error(
      `Unattended Goal is blocked: ${runtime.blockedReason ?? "OWNER review or renewed authorization is required"}`,
    );
  }
  if (!runtime || runtime.state !== "ACTIVE") return;
  const current = await readUnattendedGoalBudget(taskId, database);
  if (!current) throw new Error("Unattended Goal changed state during budget validation");
  const general = evaluateRuntimeBudget(current.runtime, current.snapshot);
  let verdict: GoalBudgetVerdict = general;
  if (general.ok && operation === "CREATE_CHILD" && current.snapshot.childTasks >= current.runtime.maxChildTasks) {
    verdict = { ok: false, reason: "MAX_CHILD_TASKS", detail: `Child task count ${current.snapshot.childTasks} reached limit ${current.runtime.maxChildTasks}`, snapshot: current.snapshot };
  } else if (general.ok && operation === "START_CHILD" && current.snapshot.concurrentChildren >= current.runtime.maxConcurrentChildren) {
    verdict = { ok: false, reason: "MAX_CONCURRENT_CHILDREN", detail: `Concurrent child executions ${current.snapshot.concurrentChildren} reached limit ${current.runtime.maxConcurrentChildren}`, snapshot: current.snapshot };
  } else if (general.ok && operation === "CAPABILITY_JOB" && current.snapshot.capabilityJobs >= current.runtime.maxCapabilityJobs) {
    verdict = { ok: false, reason: "MAX_CAPABILITY_JOBS", detail: `External Job count ${current.snapshot.capabilityJobs} reached limit ${current.runtime.maxCapabilityJobs}`, snapshot: current.snapshot };
  }
  if (!verdict.ok) {
    await blockGoal(taskId, verdict, database);
    throw new Error(`Unattended Goal blocked: ${verdict.detail}`);
  }
}

export async function recordUnattendedGoalProgressFact(
  input: { taskId: string; kind: GoalProgressFactKind; dedupKey: string },
  database: GoalPolicyDb = db,
): Promise<{ recorded: boolean; verdict: GoalBudgetVerdict | null }> {
  const failure = input.kind === "CHILD_FAILED" || input.kind === "CAPABILITY_JOB_FAILED";
  const progress = input.kind === "CHILD_SUCCEEDED" || input.kind === "CAPABILITY_JOB_SUCCEEDED";
  let recorded = false;
  try {
    recorded = await database.$transaction(async (tx) => {
      const runtime = await tx.unattendedGoalRuntime.findUnique({ where: { taskId: input.taskId } });
      if (!runtime || runtime.state !== "ACTIVE") return false;
      await tx.unattendedGoalProgressFact.create({
        data: {
          id: randomUUID(),
          taskId: input.taskId,
          kind: input.kind,
          outcome: progress ? "PROGRESS" : failure ? "FAILURE" : "TURN",
          dedupKey: input.dedupKey,
        },
      });
      await tx.unattendedGoalRuntime.update({
        where: { taskId: input.taskId },
        data: {
          lastEventKind: input.kind,
          ...(input.kind === "PROVIDER_TURN_COMPLETED"
            ? { providerTurns: { increment: 1 }, noProgressTurns: { increment: 1 } }
            : progress
              ? { consecutiveFailures: 0, noProgressTurns: 0, lastProgressAt: new Date() }
              : { consecutiveFailures: { increment: 1 } }),
        },
      });
      return true;
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
  return { recorded, verdict: recorded ? await enforceUnattendedGoalBudget(input.taskId, database) : null };
}

export async function scheduleUnattendedGoalWakeup(
  input: { taskId: string; delaySeconds: number; reason: string },
  database: GoalPolicyDb = db,
  now = new Date(),
) {
  const verdict = await enforceUnattendedGoalBudget(input.taskId, database, now);
  if (verdict && !verdict.ok) throw new Error(`Unattended Goal blocked: ${verdict.detail}`);
  const runtime = await readActiveRuntime(input.taskId, database);
  if (!runtime || runtime.state !== "ACTIVE") throw new Error("Unattended Goal is not active");
  const delaySeconds = Math.max(10, Math.min(Math.trunc(input.delaySeconds), 7 * 24 * 60 * 60));
  const wakeAt = new Date(now.getTime() + delaySeconds * 1_000);
  const deadline = new Date(runtime.activatedAt.getTime() + runtime.maxDurationMs);
  if (wakeAt > deadline) throw new Error("Wakeup would occur after the Goal duration budget expires");
  return database.unattendedGoalRuntime.update({
    where: { taskId: input.taskId },
    data: {
      nextWakeAt: wakeAt,
      wakeReason: input.reason.trim().slice(0, 1_000),
      wakeGeneration: { increment: 1 },
      wakePublishedAt: null,
      lastEventKind: "TIMER_SCHEDULED",
    },
  });
}

async function publishDueWakeup(runtime: UnattendedGoalRuntime, database: GoalPolicyDb, now: Date) {
  if (runtime.state !== "ACTIVE" || !runtime.nextWakeAt || runtime.wakePublishedAt) return false;
  return database.$transaction(async (tx) => {
    const current = await tx.unattendedGoalRuntime.findUnique({ where: { taskId: runtime.taskId } });
    if (
      !current
      || current.state !== "ACTIVE"
      || !current.nextWakeAt
      || current.nextWakeAt > now
      || current.wakeGeneration !== runtime.wakeGeneration
      || current.wakePublishedAt
    ) return false;
    const task = await tx.task.findUnique({ where: { id: runtime.taskId }, select: { id: true, title: true } });
    if (!task) return false;
    await persistWorkbenchCommand(tx, {
      parentTaskId: task.id,
      sourceTaskId: task.id,
      kind: "GOAL_TIMER_DUE",
      priority: "NORMAL",
      dedupKey: `goal-timer:${task.id}:${current.wakeGeneration}`,
      payload: {
        childTaskId: task.id,
        childTitle: task.title,
        status: "DUE",
        summary: current.wakeReason ?? "Scheduled unattended Goal check is due",
        revision: String(current.wakeGeneration),
      },
    });
    await tx.unattendedGoalRuntime.update({
      where: { taskId: task.id },
      data: {
        wakePublishedAt: now,
        nextWakeAt: null,
        wakeReason: null,
        lastEventKind: "TIMER_DUE",
      },
    });
    return true;
  });
}

export async function reconcileUnattendedGoals(
  now = new Date(),
  database: GoalPolicyDb = db,
): Promise<{ scanned: number; timersPublished: number; blocked: number; recoveredBlockEvents: number }> {
  const [active, unpublishedBlocks] = await Promise.all([
    database.unattendedGoalRuntime.findMany({
      where: { state: "ACTIVE" },
      orderBy: { updatedAt: "asc" },
      take: 100,
    }),
    database.unattendedGoalRuntime.findMany({
      where: { state: "BLOCKED", blockEventPublishedAt: null },
      orderBy: { updatedAt: "asc" },
      take: 100,
    }),
  ]);
  let timersPublished = 0;
  let blocked = 0;
  let recoveredBlockEvents = 0;
  for (const runtime of active) {
    const verdict = await enforceUnattendedGoalBudget(runtime.taskId, database, now);
    if (verdict && !verdict.ok) {
      blocked++;
      continue;
    }
    if (runtime.nextWakeAt && runtime.nextWakeAt <= now && await publishDueWakeup(runtime, database, now)) {
      timersPublished++;
    }
  }
  for (const runtime of unpublishedBlocks) {
    await publishBlockedGoalIfNeeded(runtime, database);
    recoveredBlockEvents++;
  }
  return { scanned: active.length + unpublishedBlocks.length, timersPublished, blocked, recoveredBlockEvents };
}
