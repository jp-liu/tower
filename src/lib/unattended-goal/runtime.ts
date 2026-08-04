import type { PrismaClient } from "@prisma/client";
import { setUnattendedSignal } from "@/lib/harness/unattended-signal";

export type UnattendedGoalLifecycleEvent =
  | "ACTIVATED"
  | "DEACTIVATED"
  | "TASK_LEFT_ACTIVE_LOOP"
  | "TERMINAL_STOPPED"
  | "TERMINAL_COMPLETED";

type RuntimeDb = Pick<PrismaClient, "task" | "unattendedGoalRuntime" | "$transaction">;

export interface UnattendedGoalSnapshot {
  taskId: string;
  active: boolean;
  state: "ACTIVE" | "ENDED";
  lastEventKind: string;
  activatedAt: Date;
  endedAt: Date | null;
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
    runtime: runtime
      ? {
          taskId: runtime.taskId,
          active,
          state: runtime.state,
          lastEventKind: runtime.lastEventKind,
          activatedAt: runtime.activatedAt,
          endedAt: runtime.endedAt,
        }
      : null,
  };
}

export async function applyUnattendedGoalLifecycleEvent(
  db: RuntimeDb,
  input: { taskId: string; event: UnattendedGoalLifecycleEvent },
): Promise<UnattendedGoalSnapshot> {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { id: true },
  });
  if (!task) throw new Error("task not found");

  const active = input.event === "ACTIVATED";
  const now = new Date();
  const runtime = await db.$transaction(async (tx) => {
    // Dual-write the compatibility shadow until the next migration window.
    await tx.task.update({
      where: { id: input.taskId },
      data: { unattended: active },
    });
    const existing = await tx.unattendedGoalRuntime.findUnique({
      where: { taskId: input.taskId },
    });
    if (existing && (existing.state === "ACTIVE") === active) {
      return existing;
    }
    if (!existing) {
      return tx.unattendedGoalRuntime.create({
        data: {
          taskId: input.taskId,
          state: active ? "ACTIVE" : "ENDED",
          lastEventKind: input.event,
          activatedAt: now,
          endedAt: active ? null : now,
        },
      });
    }
    return tx.unattendedGoalRuntime.update({
      where: { taskId: input.taskId },
      data: {
        state: active ? "ACTIVE" : "ENDED",
        lastEventKind: input.event,
        ...(active ? { activatedAt: now, endedAt: null } : { endedAt: now }),
      },
    });
  });

  setUnattendedSignal(input.taskId, active);
  return {
    taskId: runtime.taskId,
    active,
    state: runtime.state,
    lastEventKind: runtime.lastEventKind,
    activatedAt: runtime.activatedAt,
    endedAt: runtime.endedAt,
  };
}

export async function activateUnattendedGoal(db: RuntimeDb, taskId: string) {
  return applyUnattendedGoalLifecycleEvent(db, { taskId, event: "ACTIVATED" });
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
