import type { Prisma, PrismaClient } from "@prisma/client";
import { setUnattendedSignal } from "@/lib/harness/unattended-signal";

export type UnattendedGoalLifecycleEvent =
  | "ACTIVATED"
  | "DEACTIVATED"
  | "TASK_LEFT_ACTIVE_LOOP"
  | "TERMINAL_STOPPED"
  | "TERMINAL_COMPLETED";

type RuntimeDb = Pick<PrismaClient, "task" | "unattendedGoalRuntime" | "capabilityGrant" | "$transaction">;
type RuntimeStore = Pick<Prisma.TransactionClient, "task" | "unattendedGoalRuntime" | "capabilityGrant">;
type GoalStateDb = Pick<PrismaClient, "unattendedGoalRuntime">;

export interface UnattendedGoalPolicy {
  maxDurationMs: number;
  maxProviderTurns: number;
  maxChildTasks: number;
  maxConcurrentChildren: number;
  maxConsecutiveFailures: number;
  maxNoProgressTurns: number;
  maxCapabilityJobs: number;
  maxTokens?: number | null;
  maxCostUsdCents?: number | null;
}

export const DEFAULT_UNATTENDED_GOAL_POLICY: UnattendedGoalPolicy = {
  maxDurationMs: 8 * 60 * 60 * 1_000,
  maxProviderTurns: 100,
  maxChildTasks: 50,
  maxConcurrentChildren: 4,
  maxConsecutiveFailures: 3,
  maxNoProgressTurns: 5,
  maxCapabilityJobs: 20,
  maxTokens: null,
  maxCostUsdCents: null,
};

function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizePolicy(input?: Partial<UnattendedGoalPolicy>): UnattendedGoalPolicy {
  const policy = { ...DEFAULT_UNATTENDED_GOAL_POLICY, ...input };
  return {
    maxDurationMs: boundedInteger("maxDurationMs", policy.maxDurationMs, 5 * 60_000, 7 * 24 * 60 * 60_000),
    maxProviderTurns: boundedInteger("maxProviderTurns", policy.maxProviderTurns, 1, 10_000),
    maxChildTasks: boundedInteger("maxChildTasks", policy.maxChildTasks, 1, 1_000),
    maxConcurrentChildren: boundedInteger("maxConcurrentChildren", policy.maxConcurrentChildren, 1, 100),
    maxConsecutiveFailures: boundedInteger("maxConsecutiveFailures", policy.maxConsecutiveFailures, 1, 100),
    maxNoProgressTurns: boundedInteger("maxNoProgressTurns", policy.maxNoProgressTurns, 1, 100),
    maxCapabilityJobs: boundedInteger("maxCapabilityJobs", policy.maxCapabilityJobs, 1, 1_000),
    maxTokens: policy.maxTokens == null ? null : boundedInteger("maxTokens", policy.maxTokens, 1, 2_000_000_000),
    maxCostUsdCents: policy.maxCostUsdCents == null
      ? null
      : boundedInteger("maxCostUsdCents", policy.maxCostUsdCents, 1, 2_000_000_000),
  };
}

export interface UnattendedGoalSnapshot {
  taskId: string;
  active: boolean;
  state: "ACTIVE" | "BLOCKED" | "ENDED";
  lastEventKind: string;
  activatedAt: Date;
  endedAt: Date | null;
  blockedAt: Date | null;
  blockedReason: string | null;
  providerTurns: number;
  consecutiveFailures: number;
  noProgressTurns: number;
  lastProgressAt: Date | null;
  nextWakeAt: Date | null;
  wakeReason: string | null;
  policy: UnattendedGoalPolicy;
}

export async function readUnattendedGoalAuthorizationState(
  db: GoalStateDb,
  taskId: string,
): Promise<"ACTIVE" | "BLOCKED" | "ENDED" | null> {
  const runtime = await db.unattendedGoalRuntime.findUnique({
    where: { taskId },
    select: { state: true },
  });
  return runtime?.state ?? null;
}

function snapshot(runtime: {
  taskId: string;
  state: "ACTIVE" | "BLOCKED" | "ENDED";
  lastEventKind: string;
  activatedAt: Date;
  endedAt: Date | null;
  blockedAt: Date | null;
  blockedReason: string | null;
  providerTurns: number;
  consecutiveFailures: number;
  noProgressTurns: number;
  lastProgressAt: Date | null;
  nextWakeAt: Date | null;
  wakeReason: string | null;
  maxDurationMs: number;
  maxProviderTurns: number;
  maxChildTasks: number;
  maxConcurrentChildren: number;
  maxConsecutiveFailures: number;
  maxNoProgressTurns: number;
  maxCapabilityJobs: number;
  maxTokens: number | null;
  maxCostUsdCents: number | null;
}): UnattendedGoalSnapshot {
  return {
    taskId: runtime.taskId,
    active: runtime.state === "ACTIVE",
    state: runtime.state,
    lastEventKind: runtime.lastEventKind,
    activatedAt: runtime.activatedAt,
    endedAt: runtime.endedAt,
    blockedAt: runtime.blockedAt,
    blockedReason: runtime.blockedReason,
    providerTurns: runtime.providerTurns,
    consecutiveFailures: runtime.consecutiveFailures,
    noProgressTurns: runtime.noProgressTurns,
    lastProgressAt: runtime.lastProgressAt,
    nextWakeAt: runtime.nextWakeAt,
    wakeReason: runtime.wakeReason,
    policy: {
      maxDurationMs: runtime.maxDurationMs,
      maxProviderTurns: runtime.maxProviderTurns,
      maxChildTasks: runtime.maxChildTasks,
      maxConcurrentChildren: runtime.maxConcurrentChildren,
      maxConsecutiveFailures: runtime.maxConsecutiveFailures,
      maxNoProgressTurns: runtime.maxNoProgressTurns,
      maxCapabilityJobs: runtime.maxCapabilityJobs,
      maxTokens: runtime.maxTokens,
      maxCostUsdCents: runtime.maxCostUsdCents,
    },
  };
}

export async function readUnattendedGoalMode(
  db: RuntimeDb,
  taskId: string,
): Promise<{
  task: { id: string; title: string };
  active: boolean;
  runtime: UnattendedGoalSnapshot | null;
}> {
  const [task, runtime] = await Promise.all([
    db.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, unattended: true },
    }),
    db.unattendedGoalRuntime.findUnique({ where: { taskId } }),
  ]);
  if (!task) throw new Error("task not found");

  // The legacy field remains a read fallback during the one-release migration
  // window. Every new write creates the module-owned projection.
  const active = runtime ? runtime.state === "ACTIVE" : task.unattended;
  return {
    task: { id: task.id, title: task.title },
    active,
    runtime: runtime ? snapshot(runtime) : null,
  };
}

export async function applyUnattendedGoalLifecycleEventInTransaction(
  database: RuntimeStore,
  input: {
    taskId: string;
    event: UnattendedGoalLifecycleEvent;
    policy?: Partial<UnattendedGoalPolicy>;
    refreshActive?: boolean;
  },
): Promise<UnattendedGoalSnapshot> {
  const task = await database.task.findUnique({
    where: { id: input.taskId },
    select: { id: true },
  });
  if (!task) throw new Error("task not found");

  const active = input.event === "ACTIVATED";
  const policy = normalizePolicy(input.policy);
  const now = new Date();
  // Dual-write the compatibility shadow until the next migration window.
  await database.task.update({
    where: { id: input.taskId },
    data: { unattended: active },
    select: { id: true },
  });
  // A Goal that cannot continue must not leave any bounded write authority
  // behind. Keep revocation in the same transaction as the runtime/shadow
  // transition so every lifecycle producer (UI, MCP, terminal, task status)
  // gets the invariant, not only the UI disable action.
  if (!active) {
    await database.capabilityGrant.updateMany({
      where: { taskId: input.taskId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  const existing = await database.unattendedGoalRuntime.findUnique({
    where: { taskId: input.taskId },
  });
  if (!existing) {
    const runtime = await database.unattendedGoalRuntime.create({
      data: {
        taskId: input.taskId,
        state: active ? "ACTIVE" : "ENDED",
        lastEventKind: input.event,
        activatedAt: now,
        endedAt: active ? null : now,
        blockedAt: null,
        blockedReason: null,
        lastProgressAt: active ? now : null,
        ...policy,
      },
    });
    return snapshot(runtime);
  }
  const sameState = (existing.state === "ACTIVE") === active;
  if (sameState && (!active || !input.refreshActive)) return snapshot(existing);
  const runtime = await database.unattendedGoalRuntime.update({
    where: { taskId: input.taskId },
    data: {
      state: active ? "ACTIVE" : "ENDED",
      lastEventKind: input.event,
      ...(active
        ? {
            activatedAt: now,
            endedAt: null,
            blockedAt: null,
            blockedReason: null,
            providerTurns: 0,
            consecutiveFailures: 0,
            noProgressTurns: 0,
            lastProgressAt: now,
            nextWakeAt: null,
            wakeReason: null,
            wakePublishedAt: null,
            blockEventPublishedAt: null,
            ...policy,
          }
        : {
            endedAt: now,
            nextWakeAt: null,
            wakeReason: null,
          }),
    },
  });

  return snapshot(runtime);
}

export async function applyUnattendedGoalLifecycleEvent(
  database: RuntimeDb,
  input: {
    taskId: string;
    event: UnattendedGoalLifecycleEvent;
    policy?: Partial<UnattendedGoalPolicy>;
    refreshActive?: boolean;
  },
): Promise<UnattendedGoalSnapshot> {
  const active = input.event === "ACTIVATED";
  const runtime = await database.$transaction((tx) =>
    applyUnattendedGoalLifecycleEventInTransaction(tx, input));

  setUnattendedSignal(input.taskId, active);
  return runtime;
}

export async function activateUnattendedGoal(
  db: RuntimeDb,
  taskId: string,
  policy?: Partial<UnattendedGoalPolicy>,
) {
  return applyUnattendedGoalLifecycleEvent(db, { taskId, event: "ACTIVATED", policy });
}

export async function endUnattendedGoal(
  db: RuntimeDb,
  taskId: string,
  event: Exclude<UnattendedGoalLifecycleEvent, "ACTIVATED">,
) {
  return applyUnattendedGoalLifecycleEvent(db, { taskId, event });
}

export async function endUnattendedGoalIfActive(
  db: RuntimeDb,
  taskId: string,
  event: Exclude<UnattendedGoalLifecycleEvent, "ACTIVATED">,
): Promise<UnattendedGoalSnapshot | null> {
  const [runtime, task] = await Promise.all([
    db.unattendedGoalRuntime.findUnique({ where: { taskId }, select: { state: true } }),
    db.task.findUnique({ where: { id: taskId }, select: { unattended: true } }),
  ]);
  if (!task || (runtime?.state !== "ACTIVE" && !task.unattended)) {
    setUnattendedSignal(taskId, false);
    return null;
  }
  return endUnattendedGoal(db, taskId, event);
}
