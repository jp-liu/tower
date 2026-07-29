import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { up } from "../../../../scripts/migrations/0014-workbench-events";
import { up as addExecutionReviewKey } from "../../../../scripts/migrations/0015-workbench-execution-review-key";
import { up as addWorkbenchBatchAck } from "../../../../scripts/migrations/0021-workbench-batch-ack";
import { up as addWorkbenchRuntime } from "../../../../scripts/migrations/0022-workbench-runtime";

const tempDirs: string[] = [];
let prisma: PrismaClient;

vi.mock("@/lib/db", () => ({
  get db() {
    return prisma;
  },
}));

vi.mock("@/lib/pty/session-store", () => ({
  getSession: vi.fn(() => undefined),
  markSessionTurnComplete: vi.fn(() => true),
}));

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-workbench-coordinator-"));
  tempDirs.push(dir);
  const client = new PrismaClient({ datasourceUrl: `file:${join(dir, "coordinator.db")}` });
  await client.$executeRawUnsafe(`PRAGMA foreign_keys=ON`);
  await client.$executeRawUnsafe(`CREATE TABLE "Task" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL DEFAULT '', "parentTaskId" TEXT)`);
  await client.$executeRawUnsafe(`
    CREATE TABLE "TaskExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "agent" TEXT NOT NULL DEFAULT 'CLAUDE_CODE',
      "sessionId" TEXT,
      "endedAt" DATETIME,
      "exitCode" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "SystemConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL UNIQUE,
      "value" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "TaskMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "role" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "executionId" TEXT,
      "metadata" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "GatewayInbound" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "state" TEXT NOT NULL,
      "lastError" TEXT,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await up(client);
  await addExecutionReviewKey(client);
  await addWorkbenchBatchAck(client);
  await addWorkbenchRuntime(client);
  await client.$executeRawUnsafe(`INSERT INTO "Task" ("id", "title", "parentTaskId") VALUES ('parent', 'Parent', NULL), ('child-a', 'Child A', 'parent'), ('child-b', 'Child B', 'parent'), ('child-c', 'Child C', 'parent')`);
  await client.$executeRawUnsafe(`INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('parent-exec', 'parent', 'RUNNING')`);
  return client;
}

beforeEach(async () => {
  prisma = await database();
  const { resetWorkbenchDrainBoundariesForTests } = await import("@/lib/workbench/boundary");
  resetWorkbenchDrainBoundariesForTests();
});

afterEach(async () => {
  await prisma.$disconnect();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("Workbench durable coordinator", () => {
  it("stores a duplicate callback once by stable dedupKey", async () => {
    const { buildWorkbenchBatchPrompt, childStopDedupKey, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    const input = {
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED" as const,
      dedupKey: "child-stop:review:child-a:session:turn-1",
      payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    };

    const first = await enqueueWorkbenchEvent(input);
    const duplicate = await enqueueWorkbenchEvent(input);

    expect(first.deduped).toBe(false);
    expect(duplicate.deduped).toBe(true);
    expect(duplicate.event.id).toBe(first.event.id);
    expect(await prisma.workbenchEvent.count()).toBe(1);
    const stable = childStopDedupKey({
      taskId: "child-a", executionId: "exec-1", sessionId: "s1", eventId: "turn-1", kind: "CHILD_REVIEW_REQUIRED",
    });
    expect(stable).toBe(childStopDedupKey({
      taskId: "child-a", executionId: "exec-1", sessionId: "changed-session", eventId: "turn-1", kind: "CHILD_REVIEW_REQUIRED",
    }));
    expect(stable).not.toBe(childStopDedupKey({
      taskId: "child-a", executionId: "exec-2", sessionId: "s1", eventId: "turn-1", kind: "CHILD_REVIEW_REQUIRED",
    }));
    expect(buildWorkbenchBatchPrompt([first.event], "wb-single")).toContain(
      "Please review as the hub:",
    );
  });

  it("dispatches sibling events as one batch and consumes them only after agent acknowledgement", async () => {
    const {
      acknowledgeWorkbenchBatch,
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      resolveWorkbenchBatch,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent", sourceTaskId: "child-a", kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "review-a", payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "ready" },
    });
    await enqueueWorkbenchEvent({
      parentTaskId: "parent", sourceTaskId: "child-b", kind: "CHILD_EXECUTION_FAILED", priority: "HIGH",
      dedupKey: "failed-b", payload: { childTaskId: "child-b", childTitle: "Child B", executionId: "exec-b", exitCode: 1 },
    });
    await enqueueWorkbenchEvent({
      parentTaskId: "parent", sourceTaskId: "child-c", kind: "CHILD_DECISION_REQUIRED", priority: "HIGH",
      dedupKey: "decision-c", payload: { childTaskId: "child-c", childTitle: "Child C", question: "Use A or B?" },
    });

    const deliveries: Array<{ kinds: string[]; prompt: string }> = [];
    const result = await drainWorkbenchEvents("parent", async (batch) => {
      deliveries.push({ kinds: batch.events.map((event) => event.kind), prompt: batch.prompt });
    });

    expect(result).toMatchObject({ delivered: true, eventCount: 3 });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].kinds).toEqual([
      "CHILD_EXECUTION_FAILED",
      "CHILD_DECISION_REQUIRED",
      "CHILD_REVIEW_REQUIRED",
    ]);
    expect(deliveries[0].prompt).toContain("3 durable sub-task events");
    expect(deliveries[0].prompt).toContain("ack_workbench_batch");
    expect(await prisma.workbenchEvent.count({ where: { state: "PROCESSING" } })).toBe(3);
    expect(await prisma.workbenchEvent.count({ where: { state: "CONSUMED" } })).toBe(0);
    expect(await prisma.workbenchBatch.findUnique({ where: { id: result.batchKey! } }))
      .toMatchObject({ state: "DISPATCHED", dispatchAttempts: 1 });
    expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
      .toMatchObject({
        generation: 1,
        state: "BUSY",
        activeBatchId: result.batchKey,
        pendingEvents: 3,
      });

    await expect(acknowledgeWorkbenchBatch(result.batchKey!, "parent")).resolves.toMatchObject({
      state: "ACKED",
      eventCount: 3,
      noOp: false,
    });
    expect(await prisma.workbenchEvent.count({ where: { state: "CONSUMED" } })).toBe(3);
    await expect(resolveWorkbenchBatch(result.batchKey!, "parent")).resolves.toMatchObject({
      state: "RESOLVED",
      noOp: false,
    });
    expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
      .toMatchObject({
        state: "IDLE",
        activeBatchId: null,
        pendingEvents: 0,
      });
    await expect(resolveWorkbenchBatch(result.batchKey!, "parent")).resolves.toMatchObject({
      state: "RESOLVED",
      noOp: true,
    });
    await expect(acknowledgeWorkbenchBatch(result.batchKey!, "parent")).resolves.toMatchObject({
      state: "RESOLVED",
      noOp: true,
    });
    expect(await prisma.taskMessage.count()).toBe(1);

    await expect(drainWorkbenchEvents("parent", async () => {})).resolves.toEqual({
      delivered: false,
      eventCount: 0,
    });
  });

  it("delivers a gateway request through the durable boundary and advances its queue state", async () => {
    const { acknowledgeWorkbenchBatch, drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(`INSERT INTO "GatewayInbound" ("id", "state") VALUES ('gateway-in-1', 'QUEUED')`);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "GATEWAY_WORK_REQUEST",
      dedupKey: "gateway-work:gateway-in-1",
      payload: {
        childTaskId: "parent",
        childTitle: "Gateway request",
        gatewayInboundId: "gateway-in-1",
        gatewaySessionId: "gateway-session-1",
        gatewayMessage: "[Gateway project work request]\nCreate the import task.",
      },
    });

    const prompts: string[] = [];
    const result = await drainWorkbenchEvents("parent", async (batch) => {
      prompts.push(batch.prompt);
    });
    expect(result).toMatchObject({ delivered: true, eventCount: 1 });

    expect(prompts[0]).toContain("Create the import task.");
    const gatewayRows = await prisma.$queryRawUnsafe<Array<{ state: string; lastError: string | null }>>(
      `SELECT "state", "lastError" FROM "GatewayInbound" WHERE "id" = 'gateway-in-1'`,
    );
    expect(gatewayRows[0]).toMatchObject({ state: "PROCESSING", lastError: null });
    expect(await prisma.workbenchEvent.findFirst({ where: { dedupKey: "gateway-work:gateway-in-1" } }))
      .toMatchObject({ state: "PROCESSING", batchId: result.batchKey });
    await acknowledgeWorkbenchBatch(result.batchKey!, "parent");
    expect(await prisma.workbenchEvent.findFirst({ where: { dedupKey: "gateway-work:gateway-in-1" } }))
      .toMatchObject({ state: "CONSUMED" });
  });

  it("returns failed deliveries to pending and reuses the durable batch message on retry", async () => {
    const { acknowledgeWorkbenchBatch, drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent", sourceTaskId: "child-a", kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "retry-a", payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    });

    const failed = await drainWorkbenchEvents("parent", async () => {
      throw new Error("terminal unavailable");
    });
    expect(failed.delivered).toBe(false);
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      state: "PENDING",
      attempts: 1,
      lastError: "terminal unavailable",
    });

    const retried = await drainWorkbenchEvents("parent", async () => {});
    expect(retried.delivered).toBe(true);
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "PROCESSING", attempts: 2 });
    await acknowledgeWorkbenchBatch(retried.batchKey!, "parent");
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "CONSUMED", attempts: 2 });
    expect(await prisma.taskMessage.count()).toBe(1);
  });

  it("returns an unacknowledged dispatched batch to pending after its ACK lease", async () => {
    const {
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      recoverWorkbenchEventClaims,
      WORKBENCH_ACK_LEASE_MS,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "ack-timeout",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const result = await drainWorkbenchEvents("parent", async () => {});
    const now = new Date("2026-07-27T12:00:00.000Z");
    await prisma.workbenchBatch.update({
      where: { id: result.batchKey! },
      data: { dispatchedAt: new Date(now.getTime() - WORKBENCH_ACK_LEASE_MS - 1) },
    });

    await expect(recoverWorkbenchEventClaims(now)).resolves.toBe(1);
    expect(await prisma.workbenchBatch.findUnique({ where: { id: result.batchKey! } }))
      .toMatchObject({ state: "FAILED" });
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      state: "PENDING",
      batchId: null,
    });
    expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
      .toMatchObject({
        state: "BLOCKED",
        activeBatchId: null,
        pendingEvents: 1,
      });
  });

  it("recovers an expired processing lease after restart", async () => {
    const { enqueueWorkbenchEvent, recoverWorkbenchEventClaims, WORKBENCH_CLAIM_LEASE_MS } = await import("@/lib/workbench/coordinator");
    const { event } = await enqueueWorkbenchEvent({
      parentTaskId: "parent", sourceTaskId: "child-a", kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "stale-a", payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const now = new Date("2026-07-27T12:00:00.000Z");
    await prisma.workbenchEvent.update({
      where: { id: event.id },
      data: {
        state: "PROCESSING",
        claimToken: "dead-worker",
        claimedAt: new Date(now.getTime() - WORKBENCH_CLAIM_LEASE_MS - 1),
      },
    });

    await expect(recoverWorkbenchEventClaims(now)).resolves.toBe(1);
    expect(await prisma.workbenchEvent.findUnique({ where: { id: event.id } })).toMatchObject({
      state: "PENDING",
      claimToken: null,
      claimedAt: null,
    });
  });

  it("restores a lost drain token only for a live PTY at a completed-turn boundary", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const { restoreWorkbenchDrainBoundary } = await import("@/lib/workbench/coordinator");
    const {
      hasWorkbenchDrainBoundary,
      resetWorkbenchDrainBoundariesForTests,
    } = await import("@/lib/workbench/boundary");

    vi.mocked(getSession).mockReturnValue({
      killed: false,
      isAtTurnBoundary: false,
    } as never);
    expect(restoreWorkbenchDrainBoundary("parent")).toBe(false);
    expect(hasWorkbenchDrainBoundary("parent")).toBe(false);

    vi.mocked(getSession).mockReturnValue({
      killed: false,
      isAtTurnBoundary: true,
    } as never);
    expect(restoreWorkbenchDrainBoundary("parent")).toBe(true);
    expect(hasWorkbenchDrainBoundary("parent")).toBe(true);

    resetWorkbenchDrainBoundariesForTests();
  });

  it("restarts a missing Workbench for durable pending events", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const {
      enqueueWorkbenchEvent,
      reconcilePendingWorkbenchEvents,
    } = await import("@/lib/workbench/coordinator");
    const { hasWorkbenchDrainBoundary } = await import("@/lib/workbench/boundary");
    vi.mocked(getSession).mockReturnValue(undefined);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "reconcile-missing-parent",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const ensure = vi.fn(async () => ({
      mode: "continued" as const,
      executionId: "parent-exec-2",
    }));

    await expect(reconcilePendingWorkbenchEvents(ensure)).resolves.toEqual({
      scanned: 1,
      woken: 1,
      busy: 0,
      failed: 0,
    });
    expect(ensure).toHaveBeenCalledWith("parent");
    expect(hasWorkbenchDrainBoundary("parent")).toBe(true);
  });

  it("leaves pending events durable while the live Workbench is busy", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const {
      enqueueWorkbenchEvent,
      reconcilePendingWorkbenchEvents,
    } = await import("@/lib/workbench/coordinator");
    vi.mocked(getSession).mockReturnValue({
      killed: false,
      isAtTurnBoundary: false,
    } as never);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "reconcile-busy-parent",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const ensure = vi.fn();

    await expect(reconcilePendingWorkbenchEvents(ensure)).resolves.toEqual({
      scanned: 1,
      woken: 0,
      busy: 1,
      failed: 0,
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      state: "PENDING",
      attempts: 0,
    });
  });

  it("associates a final failed execution with its parent-owned high-priority event", async () => {
    const { enqueueChildExecutionFailure } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('child-exec', 'child-a', 'FAILED')`,
    );

    await expect(enqueueChildExecutionFailure({
      taskId: "child-a",
      taskTitle: "Child A",
      executionId: "child-exec",
      exitCode: 17,
    })).resolves.toEqual({ enqueued: true, deduped: false });

    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      executionId: "child-exec",
      kind: "CHILD_EXECUTION_FAILED",
      priority: "HIGH",
    });
  });

  it("does not duplicate a successful exit when its stop-hook review already exists", async () => {
    const { enqueueChildExecutionResult, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('child-success', 'child-a', 'COMPLETED')`,
    );
    const hook = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      executionId: "child-success",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "child-stop:review:child-a:session:turn-final",
      reviewProducer: "STOP_HOOK",
      payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    });

    await expect(enqueueChildExecutionResult({
      taskId: "child-a",
      taskTitle: "Child A",
      executionId: "child-success",
      status: "COMPLETED",
    })).resolves.toEqual({ enqueued: true, deduped: true });

    expect(await prisma.workbenchEvent.count()).toBe(1);
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      id: hook.event.id,
      dedupKey: "child-stop:review:child-a:session:turn-final",
    });
  });

  it("creates a successful-exit review fallback when no stop hook exists", async () => {
    const { childCompletionDedupKey, enqueueChildExecutionResult } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('child-success', 'child-a', 'COMPLETED')`,
    );

    await expect(enqueueChildExecutionResult({
      taskId: "child-a",
      taskTitle: "Child A",
      executionId: "child-success",
      status: "COMPLETED",
    })).resolves.toEqual({ enqueued: true, deduped: false });

    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      executionId: "child-success",
      kind: "CHILD_REVIEW_REQUIRED",
      priority: "NORMAL",
      dedupKey: childCompletionDedupKey("child-a", "child-success"),
      executionReviewKey: "execution-review:child-a:child-success",
    });
  });

  it("does not duplicate a fallback when a late stop-hook callback arrives", async () => {
    const { enqueueChildExecutionResult, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('child-success', 'child-a', 'COMPLETED')`,
    );
    await enqueueChildExecutionResult({
      taskId: "child-a",
      taskTitle: "Child A",
      executionId: "child-success",
      status: "COMPLETED",
    });

    const lateHook = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      executionId: "child-success",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "child-stop:review:child-a:session:late-turn",
      reviewProducer: "STOP_HOOK",
      payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    });

    expect(lateHook.deduped).toBe(true);
    expect(await prisma.workbenchEvent.count()).toBe(1);
  });

  it("does not create a successful-exit fallback for a task without a parent", async () => {
    const { enqueueChildExecutionResult } = await import("@/lib/workbench/coordinator");

    await expect(enqueueChildExecutionResult({
      taskId: "parent",
      taskTitle: "Top-level task",
      executionId: "top-level-exec",
      status: "COMPLETED",
    })).resolves.toEqual({ enqueued: false });
    expect(await prisma.workbenchEvent.count()).toBe(0);
  });

  it("recovers a completed execution whose event insert was lost before a crash", async () => {
    const { recoverMissingWorkbenchExecutionEvents } = await import("@/lib/workbench/coordinator");
    await prisma.systemConfig.create({
      data: {
        key: "workbench.eventsEnabledAt",
        value: JSON.stringify("2026-07-27T00:00:00.000Z"),
      },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status", "endedAt") VALUES (?, ?, ?, ?)`,
      "crash-success",
      "child-a",
      "COMPLETED",
      new Date("2026-07-27T00:01:00.000Z"),
    );

    await expect(recoverMissingWorkbenchExecutionEvents()).resolves.toMatchObject({
      scanned: 1,
      recovered: 1,
      failed: 0,
      skipped: false,
    });
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({
      sourceTaskId: "child-a",
      executionId: "crash-success",
      kind: "CHILD_REVIEW_REQUIRED",
    });
  });

  it("continues recovery until more than one batch of missing executions is exhausted", async () => {
    const { recoverMissingWorkbenchExecutionEvents } = await import("@/lib/workbench/coordinator");
    await prisma.systemConfig.create({
      data: {
        key: "workbench.eventsEnabledAt",
        value: JSON.stringify("2026-07-27T00:00:00.000Z"),
      },
    });
    for (let index = 0; index < 5; index++) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "status", "endedAt") VALUES (?, ?, ?, ?)`,
        `multi-batch-${index}`,
        "child-a",
        "COMPLETED",
        new Date(`2026-07-27T00:0${index + 1}:00.000Z`),
      );
    }

    await expect(recoverMissingWorkbenchExecutionEvents({ batchSize: 2 })).resolves.toMatchObject({
      batches: 3,
      scanned: 5,
      recovered: 5,
      failed: 0,
      remaining: 0,
      truncated: false,
      skipped: false,
    });
    expect(await prisma.workbenchEvent.count()).toBe(5);
  });

  it("skips a persistently failing execution for this pass without blocking later rows", async () => {
    const { recoverMissingWorkbenchExecutionEvents } = await import("@/lib/workbench/coordinator");
    await prisma.systemConfig.create({
      data: {
        key: "workbench.eventsEnabledAt",
        value: JSON.stringify("2026-07-27T00:00:00.000Z"),
      },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status", "endedAt") VALUES (?, 'child-a', 'COMPLETED', ?), (?, 'child-a', 'COMPLETED', ?)`,
      "recover-fails",
      new Date("2026-07-27T00:01:00.000Z"),
      "recover-after-failure",
      new Date("2026-07-27T00:02:00.000Z"),
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "reject_recovery_event"
      BEFORE INSERT ON "WorkbenchEvent"
      WHEN NEW."executionId" = 'recover-fails'
      BEGIN
        SELECT RAISE(FAIL, 'forced recovery failure');
      END
    `);

    await expect(recoverMissingWorkbenchExecutionEvents({ batchSize: 1 })).resolves.toMatchObject({
      batches: 2,
      scanned: 2,
      recovered: 1,
      failed: 1,
      remaining: 1,
      truncated: false,
      skipped: false,
    });
    expect(await prisma.workbenchEvent.findMany({ select: { executionId: true } })).toEqual([
      { executionId: "recover-after-failure" },
    ]);
  });

  it("reports remaining work when an explicit scan limit truncates the pass", async () => {
    const { recoverMissingWorkbenchExecutionEvents } = await import("@/lib/workbench/coordinator");
    await prisma.systemConfig.create({
      data: {
        key: "workbench.eventsEnabledAt",
        value: JSON.stringify("2026-07-27T00:00:00.000Z"),
      },
    });
    for (let index = 0; index < 3; index++) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "status", "endedAt") VALUES (?, 'child-a', 'COMPLETED', ?)`,
        `limited-${index}`,
        new Date(`2026-07-27T00:0${index + 1}:00.000Z`),
      );
    }

    await expect(recoverMissingWorkbenchExecutionEvents({ batchSize: 2, scanLimit: 2 })).resolves.toMatchObject({
      batches: 1,
      scanned: 2,
      recovered: 2,
      failed: 0,
      remaining: 1,
      truncated: true,
      skipped: false,
    });
  });

  it("does not recover executions that already have stop, fallback, or failure events", async () => {
    const { enqueueChildExecutionResult, enqueueWorkbenchEvent, recoverMissingWorkbenchExecutionEvents } = await import("@/lib/workbench/coordinator");
    await prisma.systemConfig.create({
      data: {
        key: "workbench.eventsEnabledAt",
        value: JSON.stringify("2026-07-27T00:00:00.000Z"),
      },
    });
    for (const [id, status] of [
      ["has-stop", "COMPLETED"],
      ["has-fallback", "COMPLETED"],
      ["has-failure", "FAILED"],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "status", "endedAt") VALUES (?, 'child-a', ?, ?)`,
        id,
        status,
        new Date("2026-07-27T00:01:00.000Z"),
      );
    }
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      executionId: "has-stop",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "stop-existing",
      reviewProducer: "STOP_HOOK",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    await enqueueChildExecutionResult({
      taskId: "child-a", taskTitle: "Child A", executionId: "has-fallback", status: "COMPLETED",
    });
    await enqueueChildExecutionResult({
      taskId: "child-a", taskTitle: "Child A", executionId: "has-failure", status: "FAILED",
    });

    await expect(recoverMissingWorkbenchExecutionEvents()).resolves.toMatchObject({
      scanned: 0,
      recovered: 0,
      failed: 0,
    });
    expect(await prisma.workbenchEvent.count()).toBe(3);
  });

  it("does not replay historical executions that ended before the checkpoint", async () => {
    const { recoverMissingWorkbenchExecutionEvents } = await import("@/lib/workbench/coordinator");
    await prisma.systemConfig.create({
      data: {
        key: "workbench.eventsEnabledAt",
        value: JSON.stringify("2026-07-27T00:10:00.000Z"),
      },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status", "endedAt") VALUES (?, ?, ?, ?)`,
      "historical-success",
      "child-a",
      "COMPLETED",
      new Date("2026-07-27T00:09:59.000Z"),
    );

    await expect(recoverMissingWorkbenchExecutionEvents()).resolves.toMatchObject({
      scanned: 0,
      recovered: 0,
      failed: 0,
      skipped: false,
    });
    expect(await prisma.workbenchEvent.count()).toBe(0);
  });
});
