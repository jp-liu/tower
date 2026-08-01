// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setSignal } = vi.hoisted(() => ({ setSignal: vi.fn() }));
vi.mock("@/lib/harness/unattended-signal", () => ({
  setUnattendedSignal: setSignal,
}));

import {
  activateUnattendedGoal,
  endUnattendedGoalIfActive,
  readUnattendedGoalMode,
} from "../runtime";

function createDb(input: { legacy?: boolean; runtime?: Record<string, unknown> | null } = {}) {
  let legacy = input.legacy ?? false;
  let runtime = input.runtime ?? null;
  const task = {
    findUnique: vi.fn(async (query: { select?: Record<string, boolean> }) => {
      if (query.select?.title) return { id: "task-1", title: "Task", unattended: legacy };
      return { id: "task-1", unattended: legacy };
    }),
    update: vi.fn(async (query: { data: { unattended: boolean } }) => {
      legacy = query.data.unattended;
      return { id: "task-1" };
    }),
  };
  const unattendedGoalRuntime = {
    findUnique: vi.fn(async () => runtime),
    create: vi.fn(async (query: { data: Record<string, unknown> }) => {
      runtime = {
        taskId: "task-1",
        activatedAt: new Date(),
        endedAt: null,
        ...query.data,
      };
      return runtime;
    }),
    update: vi.fn(async (query: { data: Record<string, unknown> }) => {
      runtime = { ...(runtime ?? {}), ...query.data };
      return runtime;
    }),
  };
  const db = {
    task,
    unattendedGoalRuntime,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ task, unattendedGoalRuntime })),
  };
  return { db, task, unattendedGoalRuntime };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unattended goal runtime", () => {
  it("reads the legacy marker only when no module projection exists", async () => {
    const { db } = createDb({ legacy: true });

    const result = await readUnattendedGoalMode(db as never, "task-1");

    expect(result.active).toBe(true);
    expect(result.runtime).toBeNull();
  });

  it("treats the module projection as authoritative", async () => {
    const { db } = createDb({
      legacy: true,
      runtime: {
        taskId: "task-1",
        state: "ENDED",
        lastEventKind: "TERMINAL_COMPLETED",
        activatedAt: new Date(),
        endedAt: new Date(),
      },
    });

    const result = await readUnattendedGoalMode(db as never, "task-1");

    expect(result.active).toBe(false);
  });

  it("activates through one module transaction and mirrors the hook signal", async () => {
    const { db, task, unattendedGoalRuntime } = createDb();

    const result = await activateUnattendedGoal(db as never, "task-1");

    expect(result.state).toBe("ACTIVE");
    expect(task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { unattended: true },
    });
    expect(unattendedGoalRuntime.create).toHaveBeenCalled();
    expect(setSignal).toHaveBeenCalledWith("task-1", true);
  });

  it("keeps the original activation time when activation is repeated", async () => {
    const activatedAt = new Date("2026-08-01T00:00:00.000Z");
    const { db, unattendedGoalRuntime } = createDb({
      legacy: true,
      runtime: {
        taskId: "task-1",
        state: "ACTIVE",
        lastEventKind: "ACTIVATED",
        activatedAt,
        endedAt: null,
      },
    });

    const result = await activateUnattendedGoal(db as never, "task-1");

    expect(result.activatedAt).toEqual(activatedAt);
    expect(unattendedGoalRuntime.create).not.toHaveBeenCalled();
    expect(unattendedGoalRuntime.update).not.toHaveBeenCalled();
    expect(setSignal).toHaveBeenCalledWith("task-1", true);
  });

  it("does not create ended projections for ordinary attended tasks", async () => {
    const { db, unattendedGoalRuntime } = createDb();

    const result = await endUnattendedGoalIfActive(db as never, "task-1", "TERMINAL_STOPPED");

    expect(result).toBeNull();
    expect(unattendedGoalRuntime.create).not.toHaveBeenCalled();
    expect(unattendedGoalRuntime.update).not.toHaveBeenCalled();
    expect(setSignal).toHaveBeenCalledWith("task-1", false);
  });
});
