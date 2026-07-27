import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { up } from "../../../../scripts/migrations/0014-workbench-events";
import { up as addExecutionReviewKey } from "../../../../scripts/migrations/0015-workbench-execution-review-key";

const tempDirs: string[] = [];
let prisma: PrismaClient;

vi.mock("@/lib/db", () => ({
  get db() {
    return prisma;
  },
}));

vi.mock("@/lib/pty/session-store", () => ({ getSession: vi.fn(() => undefined) }));

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-workbench-coordinator-"));
  tempDirs.push(dir);
  const client = new PrismaClient({ datasourceUrl: `file:${join(dir, "coordinator.db")}` });
  await client.$executeRawUnsafe(`PRAGMA foreign_keys=ON`);
  await client.$executeRawUnsafe(`CREATE TABLE "Task" ("id" TEXT NOT NULL PRIMARY KEY, "parentTaskId" TEXT)`);
  await client.$executeRawUnsafe(`
    CREATE TABLE "TaskExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  await up(client);
  await addExecutionReviewKey(client);
  await client.$executeRawUnsafe(`INSERT INTO "Task" ("id", "parentTaskId") VALUES ('parent', NULL), ('child-a', 'parent'), ('child-b', 'parent'), ('child-c', 'parent')`);
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
    expect(childStopDedupKey({ taskId: "child-a", sessionId: "s1", eventId: "turn-1", kind: "CHILD_REVIEW_REQUIRED" }))
      .toBe(childStopDedupKey({ taskId: "child-a", sessionId: "s1", eventId: "turn-1", kind: "CHILD_REVIEW_REQUIRED" }));
    expect(buildWorkbenchBatchPrompt([first.event], "wb-single")).toContain(
      "Please review as the hub:",
    );
  });

  it("claims sibling events as one priority-ordered batch and consumes them once", async () => {
    const { drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
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
    expect(await prisma.workbenchEvent.count({ where: { state: "CONSUMED" } })).toBe(3);
    expect(await prisma.taskMessage.count()).toBe(1);

    await expect(drainWorkbenchEvents("parent", async () => {})).resolves.toEqual({
      delivered: false,
      eventCount: 0,
    });
  });

  it("returns failed deliveries to pending and reuses the durable batch message on retry", async () => {
    const { drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
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
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "CONSUMED", attempts: 2 });
    expect(await prisma.taskMessage.count()).toBe(1);
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
});
