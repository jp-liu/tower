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
import { up as addCapabilityResultWakeup } from "../../../../scripts/migrations/0031-capability-result-wakeup";
import { up as addGoalPolicy } from "../../../../scripts/migrations/0032-unattended-goal-policy";
import { up as addCapabilityCompletionCallback } from "../../../../scripts/migrations/0033-capability-completion-callback";
import { up as addFinalNotification } from "../../../../scripts/migrations/0036-unattended-final-notification";

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
  enforceUnattendedGoalBudget,
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
      "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
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
      "summary" TEXT,
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
  await addCapabilityResultWakeup(client);
  await addGoalPolicy(client);
  await addCapabilityCompletionCallback(client);
  await addFinalNotification(client);
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

  it("deduplicates provider turns without using turn counts as a stop condition", async () => {
    const prisma = await database();
    await activateUnattendedGoal(prisma as never, "goal-1");
    const grant = await prisma.capabilityGrant.create({
      data: {
        taskId: "goal-1",
        capability: "human.message.send",
        risk: "R2",
        targetKind: "OWNER_HOME_ROUTE",
        targetFingerprint: "owner-route-v1",
        issuer: "TOWER_UI",
        maxUses: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

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

    expect(first).toMatchObject({ recorded: true, verdict: { ok: true } });
    expect(duplicate).toEqual({ recorded: false, verdict: null });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: "goal-1" }, select: { unattended: true } }))
      .toEqual({ unattended: true });
    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ state: "ACTIVE", providerTurns: 1, blockEventPublishedAt: null });
    expect(await prisma.workbenchEvent.count({ where: { parentTaskId: "goal-1" } })).toBe(0);
    expect(await prisma.capabilityGrant.findUniqueOrThrow({ where: { id: grant.id } }))
      .toMatchObject({ revokedAt: null });
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
    )).resolves.toEqual({ scanned: 0, timersPublished: 0, expired: 0, recoveredBlockEvents: 0 });
    expect(await prisma.workbenchEvent.count()).toBe(0);
  });

  it("keeps an ended Goal terminal when shutdown races a due-timer scan on separate connections", async () => {
    const firstProcess = await database();
    const databasePath = join(directories.at(-1)!, "goal.db");
    const runtime = await activateUnattendedGoal(firstProcess as never, "goal-1");
    await scheduleUnattendedGoalWakeup({
      taskId: "goal-1",
      delaySeconds: 10,
      reason: "Race with shutdown",
    }, firstProcess as never, runtime.activatedAt);

    const recoveryProcess = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
    clients.push(recoveryProcess);
    const dueAt = new Date(runtime.activatedAt.getTime() + 20_000);
    await Promise.all([
      endUnattendedGoal(firstProcess as never, "goal-1", "DEACTIVATED"),
      reconcileUnattendedGoals(dueAt, recoveryProcess as never),
    ]);

    const ended = await recoveryProcess.unattendedGoalRuntime.findUniqueOrThrow({
      where: { taskId: "goal-1" },
    });
    expect(ended).toMatchObject({ state: "ENDED", nextWakeAt: null });
    expect(await recoveryProcess.workbenchEvent.count({
      where: {
        parentTaskId: "goal-1",
        kind: "GOAL_TIMER_DUE",
        createdAt: { gt: ended.endedAt! },
      },
    })).toBe(0);
    await expect(reconcileUnattendedGoals(dueAt, recoveryProcess as never))
      .resolves.toEqual({ scanned: 0, timersPublished: 0, expired: 0, recoveredBlockEvents: 0 });
  });

  it("observes child tasks without gating new task or capability work", async () => {
    const prisma = await database();
    await activateUnattendedGoal(prisma as never, "goal-1");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Task" ("id", "title", "projectId", "parentTaskId")
      VALUES ('child-1', 'Existing child', 'project-1', 'goal-1')
    `);

    await expect(assertUnattendedGoalOperationAllowed("goal-1", "CAPABILITY_JOB", prisma as never))
      .resolves.toBeUndefined();
    expect(await readUnattendedGoalBudget("goal-1", prisma as never))
      .toMatchObject({ snapshot: { childTasks: 1 } });
    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ state: "ACTIVE" });
    expect(await prisma.workbenchEvent.count({
      where: { parentTaskId: "goal-1", kind: "GOAL_BLOCKED" },
    })).toBe(0);
  });

  it("ends a legacy blocked Goal when the user explicitly disables it", async () => {
    const prisma = await database();
    await activateUnattendedGoal(prisma as never, "goal-1");
    await prisma.unattendedGoalRuntime.update({
      where: { taskId: "goal-1" },
      data: { state: "BLOCKED", blockedAt: new Date(), blockedReason: "legacy limit" },
    });

    const ended = await endUnattendedGoal(prisma as never, "goal-1", "DEACTIVATED");

    expect(ended).toMatchObject({
      state: "ENDED",
      lastEventKind: "DEACTIVATED",
      endedAt: expect.any(Date),
    });
    await expect(assertUnattendedGoalOperationAllowed("goal-1", "CAPABILITY_JOB", prisma as never))
      .resolves.toBeUndefined();
    expect(await prisma.workbenchEvent.count({
      where: { parentTaskId: "goal-1", kind: "GOAL_BLOCKED" },
    })).toBe(0);

    const repeated = await endUnattendedGoal(prisma as never, "goal-1", "DEACTIVATED");
    expect(repeated.endedAt).toEqual(ended.endedAt);
  });

  it("ends normally at the deadline and never publishes GOAL_BLOCKED", async () => {
    const duration = await database();
    const durationRuntime = await activateUnattendedGoal(duration as never, "goal-1", { maxDurationMs: 300_000 });
    const grant = await duration.capabilityGrant.create({
      data: {
        taskId: "goal-1",
        capability: "human.message.send",
        risk: "R2",
        targetKind: "OWNER_HOME_ROUTE",
        targetFingerprint: "owner-route-v1",
        issuer: "TOWER_UI",
        maxUses: 0,
        expiresAt: new Date(durationRuntime.activatedAt.getTime() + 300_000),
      },
    });
    await expect(enforceUnattendedGoalBudget(
      "goal-1",
      duration as never,
      new Date(durationRuntime.activatedAt.getTime() + 300_001),
    )).resolves.toMatchObject({ ok: false, reason: "MAX_DURATION" });

    expect(await duration.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ state: "ENDED", lastEventKind: "DURATION_EXPIRED", endedAt: expect.any(Date) });
    expect(await duration.task.findUniqueOrThrow({ where: { id: "goal-1" }, select: { unattended: true } }))
      .toEqual({ unattended: false });
    expect(await duration.capabilityGrant.findUniqueOrThrow({ where: { id: grant.id } }))
      .toMatchObject({ revokedAt: expect.any(Date) });
    expect(await duration.workbenchEvent.count({
      where: { parentTaskId: "goal-1", kind: "GOAL_BLOCKED" },
    })).toBe(0);
  });

  it("does not infer failure from terminal silence when no durable limit is violated", async () => {
    const prisma = await database();
    const runtime = await activateUnattendedGoal(prisma as never, "goal-1");

    await expect(reconcileUnattendedGoals(
      new Date(runtime.activatedAt.getTime() + 60_000),
      prisma as never,
    )).resolves.toEqual({ scanned: 1, timersPublished: 0, expired: 0, recoveredBlockEvents: 0 });
    expect(await readUnattendedGoalBudget("goal-1", prisma as never))
      .toMatchObject({ runtime: { state: "ACTIVE" }, snapshot: { providerTurns: 0 } });
    expect(await prisma.workbenchEvent.count()).toBe(0);
  });
});
