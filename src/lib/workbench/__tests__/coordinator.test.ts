import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { up } from "../../../../scripts/migrations/0014-workbench-events";

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
});
