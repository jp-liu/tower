// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { up as addWorkbenchEvents } from "../../../../scripts/migrations/0014-workbench-events";
import { up as addExecutionReviewKey } from "../../../../scripts/migrations/0015-workbench-execution-review-key";
import { up as addWorkbenchBatches } from "../../../../scripts/migrations/0021-workbench-batch-ack";
import { up as addWorkbenchLeases } from "../../../../scripts/migrations/0025-workbench-batch-leases";
import { up as addGoalRuntime } from "../../../../scripts/migrations/0029-unattended-goal-runtime";
import { up as addCapabilities } from "../../../../scripts/migrations/0030-capability-runtime";
import { up as addGoalPolicy } from "../../../../scripts/migrations/0032-unattended-goal-policy";

const mocks = vi.hoisted(() => ({
  setSignal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/harness/unattended-signal", () => ({
  setUnattendedSignal: mocks.setSignal,
}));

import { activateUnattendedGoal, endUnattendedGoal } from "../runtime";
import {
  assertUnattendedGoalOperationAllowed,
  readUnattendedGoalBudget,
  reconcileUnattendedGoals,
  recordUnattendedGoalProgressFact,
  scheduleUnattendedGoalWakeup,
} from "../policy";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database(): Promise<PrismaClient> {
  const directory = await mkdtemp(join(tmpdir(), "tower-goal-policy-"));
  directories.push(directory);
  const client = new PrismaClient({ datasourceUrl: `file:${join(directory, "goal.db")}` });
  clients.push(client);
  await client.$executeRawUnsafe(`
    CREATE TABLE "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "unattended" INTEGER NOT NULL DEFAULT 0,
      "parentTaskId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "TaskExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "HarnessMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "state" TEXT NOT NULL
    )
  `);
  await addWorkbenchEvents(client);
  await addExecutionReviewKey(client);
  await addWorkbenchBatches(client);
  await addWorkbenchLeases(client);
  await addGoalRuntime(client);
  await addCapabilities(client);
  await addGoalPolicy(client);
  await client.$executeRawUnsafe(
    `INSERT INTO "Task" ("id", "title", "projectId") VALUES ('goal-1', 'Ship release', 'project-1')`,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("unattended Goal policy", () => {
  it("persists a due timer and its runtime marker atomically with one stable dedup key", async () => {
    const prisma = await database();
    const runtime = await activateUnattendedGoal(prisma as never, "goal-1");
    const now = runtime.activatedAt;
    await scheduleUnattendedGoalWakeup({
      taskId: "goal-1",
      delaySeconds: 10,
      reason: "Check the external result",
    }, prisma as never, now);
    await expect(reconcileUnattendedGoals(new Date(now.getTime() + 10_000), prisma as never))
      .resolves.toMatchObject({ timersPublished: 1 });
    await expect(reconcileUnattendedGoals(new Date(now.getTime() + 20_000), prisma as never))
      .resolves.toMatchObject({ timersPublished: 0 });

    expect(await prisma.workbenchEvent.findMany({
      where: { parentTaskId: "goal-1" },
      select: { kind: true, dedupKey: true, state: true },
    })).toEqual([{
      kind: "GOAL_TIMER_DUE",
      dedupKey: "goal-timer:goal-1:1",
      state: "PENDING",
    }]);
    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ nextWakeAt: null, wakePublishedAt: expect.any(Date) });
  });

  it("deduplicates provider turns and atomically blocks at the configured limit", async () => {
    const prisma = await database();
    await activateUnattendedGoal(prisma as never, "goal-1", { maxProviderTurns: 1 });

    const first = await recordUnattendedGoalProgressFact({
      taskId: "goal-1",
      kind: "PROVIDER_TURN_COMPLETED",
      dedupKey: "provider-turn:goal-1:turn-1",
    }, prisma as never);
    const duplicate = await recordUnattendedGoalProgressFact({
      taskId: "goal-1",
      kind: "PROVIDER_TURN_COMPLETED",
      dedupKey: "provider-turn:goal-1:turn-1",
    }, prisma as never);

    expect(first).toMatchObject({ recorded: true, verdict: { ok: false, reason: "MAX_PROVIDER_TURNS" } });
    expect(duplicate).toEqual({ recorded: false, verdict: null });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: "goal-1" }, select: { unattended: true } }))
      .toEqual({ unattended: false });
    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ state: "BLOCKED", providerTurns: 1, blockEventPublishedAt: expect.any(Date) });
    expect(await prisma.workbenchEvent.findFirst({ where: { parentTaskId: "goal-1" } }))
      .toMatchObject({ kind: "GOAL_BLOCKED", dedupKey: "goal-blocked:goal-1:1" });
  });

  it("does not publish a scheduled timer after the Goal has ended", async () => {
    const prisma = await database();
    const runtime = await activateUnattendedGoal(prisma as never, "goal-1");
    await scheduleUnattendedGoalWakeup({
      taskId: "goal-1",
      delaySeconds: 10,
      reason: "No longer needed",
    }, prisma as never, runtime.activatedAt);
    await endUnattendedGoal(prisma as never, "goal-1", "DEACTIVATED");

    await expect(reconcileUnattendedGoals(
      new Date(runtime.activatedAt.getTime() + 20_000),
      prisma as never,
    )).resolves.toEqual({ scanned: 0, timersPublished: 0, blocked: 0, recoveredBlockEvents: 0 });
    expect(await prisma.workbenchEvent.count()).toBe(0);
  });

  it("blocks before creating a child that would exceed the persistent budget", async () => {
    const prisma = await database();
    await activateUnattendedGoal(prisma as never, "goal-1", { maxChildTasks: 1 });
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Task" ("id", "title", "projectId", "parentTaskId")
      VALUES ('child-1', 'Existing child', 'project-1', 'goal-1')
    `);

    await expect(assertUnattendedGoalOperationAllowed("goal-1", "CREATE_CHILD", prisma as never))
      .rejects.toThrow(/Child task count 1 reached limit 1/);
    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ state: "BLOCKED" });
    await expect(assertUnattendedGoalOperationAllowed("goal-1", "CREATE_CHILD", prisma as never))
      .rejects.toThrow(/Unattended Goal is blocked/);
    await expect(assertUnattendedGoalOperationAllowed("goal-1", "CAPABILITY_JOB", prisma as never))
      .rejects.toThrow(/Unattended Goal is blocked/);
  });

  it("does not infer failure from terminal silence when no durable limit is violated", async () => {
    const prisma = await database();
    const runtime = await activateUnattendedGoal(prisma as never, "goal-1");

    await expect(reconcileUnattendedGoals(
      new Date(runtime.activatedAt.getTime() + 60_000),
      prisma as never,
    )).resolves.toEqual({ scanned: 1, timersPublished: 0, blocked: 0, recoveredBlockEvents: 0 });
    expect(await readUnattendedGoalBudget("goal-1", prisma as never))
      .toMatchObject({ runtime: { state: "ACTIVE" }, snapshot: { providerTurns: 0 } });
    expect(await prisma.workbenchEvent.count()).toBe(0);
  });
});
