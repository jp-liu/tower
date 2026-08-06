import { PrismaClient } from "@prisma/client";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchDrainBatch } from "@/lib/workbench/coordinator";
import { up } from "../../../../scripts/migrations/0014-workbench-events";
import { up as addExecutionReviewKey } from "../../../../scripts/migrations/0015-workbench-execution-review-key";
import { up as addWorkbenchBatchAck } from "../../../../scripts/migrations/0021-workbench-batch-ack";
import { up as addWorkbenchRuntime } from "../../../../scripts/migrations/0022-workbench-runtime";
import { up as addWorkbenchBatchLeases } from "../../../../scripts/migrations/0025-workbench-batch-leases";

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
  await client.$executeRawUnsafe(`CREATE TABLE "Task" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'TODO', "parentTaskId" TEXT)`);
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
  await addWorkbenchBatchLeases(client);
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
  const { resetWorkbenchDeliveryObserverForTests } = await import("@/lib/workbench/delivery-lifecycle");
  resetWorkbenchDeliveryObserverForTests();
  await prisma.$disconnect();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("Workbench durable coordinator", () => {
  it("projects runtime state from the provider turn boundary independently of queue depth", async () => {
    const { deriveWorkbenchBlockedReason, deriveWorkbenchRuntimeState } = await import("@/lib/workbench/coordinator");

    expect(deriveWorkbenchRuntimeState({
      hasLiveSession: true,
      hasActiveBatch: false,
      isAtTurnBoundary: true,
    })).toBe("IDLE");
    expect(deriveWorkbenchRuntimeState({
      hasLiveSession: true,
      hasActiveBatch: false,
      isAtTurnBoundary: false,
    })).toBe("BUSY");
    expect(deriveWorkbenchRuntimeState({
      hasLiveSession: true,
      hasActiveBatch: true,
      isAtTurnBoundary: true,
    })).toBe("BUSY");
    expect(deriveWorkbenchRuntimeState({
      hasLiveSession: false,
      hasActiveBatch: false,
      isAtTurnBoundary: true,
    })).toBe("DEGRADED");
    expect(deriveWorkbenchBlockedReason({
      hasLiveSession: true,
      hasActiveBatch: false,
      pendingEvents: 0,
      isAtTurnBoundary: false,
    })).toBe("Provider turn in progress");
  });

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
    const prompt = buildWorkbenchBatchPrompt([first.event], "wb-single");
    expect(prompt).toContain(
      "Please review as the hub:",
    );
    expect(prompt).toContain("every two minutes");
    expect(prompt).toContain("do not wait for the five-minute lease to expire");
  });

  it("dispatches sibling events as one batch and consumes them only after resolution", async () => {
    const {
      acknowledgeWorkbenchBatch,
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      recordWorkbenchProviderTurnCompleted,
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

    await expect(acknowledgeWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!)).resolves.toMatchObject({
      state: "ACKED",
      eventCount: 3,
      noOp: false,
    });
    expect(await prisma.workbenchEvent.count({ where: { state: "PROCESSING" } })).toBe(3);
    expect(await prisma.workbenchEvent.count({ where: { state: "CONSUMED" } })).toBe(0);
    await expect(resolveWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!)).resolves.toMatchObject({
      state: "RESOLVED",
      noOp: false,
    });
    expect(await prisma.workbenchEvent.count({ where: { state: "CONSUMED" } })).toBe(3);
    expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
      .toMatchObject({
        state: "BUSY",
        activeBatchId: null,
        pendingEvents: 0,
        lastTurnCompletedAt: null,
      });
    await expect(recordWorkbenchProviderTurnCompleted("parent")).resolves.toBe(true);
    expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
      .toMatchObject({
        state: "IDLE",
        activeBatchId: null,
        pendingEvents: 0,
        lastTurnCompletedAt: expect.any(Date),
      });
    await expect(resolveWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!)).resolves.toMatchObject({
      state: "RESOLVED",
      noOp: true,
    });
    await expect(acknowledgeWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!)).resolves.toMatchObject({
      state: "RESOLVED",
      noOp: true,
    });
    expect(await prisma.taskMessage.count()).toBe(1);

    await expect(drainWorkbenchEvents("parent", async () => {})).resolves.toEqual({
      delivered: false,
      eventCount: 0,
    });
  });

  it("uses provider turn completion as the durable fallback receipt", async () => {
    const {
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      recordWorkbenchProviderTurnCompleted,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "provider-receipt",
      payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    });
    const delivered = await drainWorkbenchEvents("parent", async () => {});

    await expect(recordWorkbenchProviderTurnCompleted("parent")).resolves.toBe(true);

    expect(await prisma.workbenchBatch.findUniqueOrThrow({ where: { id: delivered.batchKey! } }))
      .toMatchObject({ state: "RESOLVED", leaseExpiresAt: null, resolvedAt: expect.any(Date) });
    expect(await prisma.workbenchEvent.findFirstOrThrow({ where: { dedupKey: "provider-receipt" } }))
      .toMatchObject({ state: "CONSUMED", consumedAt: expect.any(Date) });
    expect(await prisma.workbenchRuntime.findUniqueOrThrow({ where: { taskId: "parent" } }))
      .toMatchObject({ state: "IDLE", activeBatchId: null, pendingEvents: 0 });
  });

  it("builds a durable capability-result wakeup prompt and forbids uncertain replay", async () => {
    const { buildWorkbenchBatchPrompt, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    const { event } = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "CAPABILITY_RESULT_AVAILABLE",
      priority: "HIGH",
      dedupKey: "capability-result:req-1:rev-1",
      payload: {
        childTaskId: "parent",
        childTitle: "Parent task",
        requestId: "req-1",
        capability: "computer.gui.act",
        status: "SIDE_EFFECT_UNKNOWN",
        revision: "rev-1",
        summary: "The remote outcome is uncertain",
        evidence: ["openclaw-task:job-1"],
        jobRef: "job-1",
      },
    });

    const prompt = buildWorkbenchBatchPrompt([event], "wb-capability", {
      generation: 1,
      leaseToken: "lease-capability",
    });
    expect(prompt).toContain("[Tower external capability result]");
    expect(prompt).toContain("Capability: computer.gui.act");
    expect(prompt).toContain("Status: SIDE_EFFECT_UNKNOWN");
    expect(prompt).toContain("Do not retry or submit a fallback request automatically");
    expect(prompt).toContain("ack_workbench_batch");
    expect(prompt).toContain("resolve_workbench_batch");
  });

  it("builds distinct timer and blocked prompts without treating silence as failure", async () => {
    const { buildWorkbenchBatchPrompt, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    const timer = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "GOAL_TIMER_DUE",
      dedupKey: "goal-timer:parent:1",
      payload: {
        childTaskId: "parent",
        childTitle: "Parent task",
        status: "DUE",
        summary: "Check the provider status",
        revision: "1",
      },
    });
    const timerPrompt = buildWorkbenchBatchPrompt([timer.event], "wb-timer");
    expect(timerPrompt).toContain("[Tower unattended Goal timer]");
    expect(timerPrompt).toContain("Do not assume that elapsed time means an external action failed");
    expect(timerPrompt).toContain("do not recreate requests that already have a requestId");

    const blocked = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "GOAL_BLOCKED",
      priority: "HIGH",
      dedupKey: "goal-blocked:parent:1",
      payload: {
        childTaskId: "parent",
        childTitle: "Parent task",
        status: "BLOCKED",
        summary: "Provider turn budget reached",
      },
    });
    const blockedPrompt = buildWorkbenchBatchPrompt([blocked.event], "wb-blocked");
    expect(blockedPrompt).toContain("[Tower unattended Goal blocked]");
    expect(blockedPrompt).toContain("Stop autonomous work");
    expect(blockedPrompt).toContain("Never bypass an expired grant");
  });

  it("renders a gateway discussion as direct Workbench work without task creation language", async () => {
    const { buildWorkbenchBatchPrompt, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    const discussion = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "GATEWAY_DISCUSSION_REQUEST",
      dedupKey: "gateway-discussion:gateway-in-1",
      payload: {
        childTaskId: "parent",
        childTitle: "Gateway discussion",
        instruction: [
          "[Gateway project discussion request]",
          "Explain the current state machine.",
          "Do not create a child task merely because a plan becomes clear.",
          "Call complete_gateway_discussion when ready.",
        ].join("\n"),
      },
    });

    const prompt = buildWorkbenchBatchPrompt([discussion.event], "wb-discussion");
    expect(prompt).toContain("[Gateway project discussion request]");
    expect(prompt).toContain("Explain the current state machine.");
    expect(prompt).toContain("Do not create a child task");
    expect(prompt).toContain("complete_gateway_discussion");
    expect(prompt).not.toContain("create_task");
  });

  it("delivers a gateway request through the durable boundary and advances its queue state", async () => {
    const {
      migrateLegacyGatewayWorkbenchCommands,
      registerGatewayWorkbenchDeliveryLifecycle,
    } = await import("@/lib/harness/workbench-delivery-adapter");
    const { acknowledgeWorkbenchBatch, drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    registerGatewayWorkbenchDeliveryLifecycle();
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
      } as never,
    });
    await expect(migrateLegacyGatewayWorkbenchCommands()).resolves.toBe(1);

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
    await acknowledgeWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!);
    expect(await prisma.workbenchEvent.findFirst({ where: { dedupKey: "gateway-work:gateway-in-1" } }))
      .toMatchObject({ state: "PROCESSING" });
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
    await acknowledgeWorkbenchBatch(retried.batchKey!, "parent", retried.leaseToken!);
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "PROCESSING", attempts: 2 });
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
      data: {
        dispatchedAt: new Date(now.getTime() - WORKBENCH_ACK_LEASE_MS - 1),
        leaseExpiresAt: new Date(now.getTime() - 1),
      },
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

  it("recovers a process crash after CLAIMED before PTY dispatch", async () => {
    const {
      enqueueWorkbenchEvent,
      recoverWorkbenchEventClaims,
      WORKBENCH_CLAIM_LEASE_MS,
    } = await import("@/lib/workbench/coordinator");
    const { event } = await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "claimed-crash",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const now = new Date("2026-07-27T12:00:00.000Z");
    const batchId = "wb-claimed-crash";
    await prisma.workbenchBatch.create({
      data: {
        id: batchId,
        parentTaskId: "parent",
        eventIds: JSON.stringify([event.id]),
        prompt: "claimed",
        state: "CLAIMED",
        leaseToken: "dead-claim",
        leaseExpiresAt: new Date(now.getTime() - 1),
        updatedAt: new Date(now.getTime() - WORKBENCH_CLAIM_LEASE_MS - 1),
      },
    });
    await prisma.workbenchEvent.update({
      where: { id: event.id },
      data: {
        state: "PROCESSING",
        claimToken: "dead-worker",
        claimedAt: new Date(now.getTime() - WORKBENCH_CLAIM_LEASE_MS - 1),
        batchId,
      },
    });

    await expect(recoverWorkbenchEventClaims(now)).resolves.toBe(1);
    expect(await prisma.workbenchBatch.findUniqueOrThrow({ where: { id: batchId } }))
      .toMatchObject({ state: "FAILED", leaseExpiresAt: null });
    expect(await prisma.workbenchEvent.findUniqueOrThrow({ where: { id: event.id } }))
      .toMatchObject({ state: "PENDING", batchId: null, consumedAt: null });
  });

  it("replays at-least-once with a stable batch id after a crash between PTY write and DISPATCHED", async () => {
    const {
      acknowledgeWorkbenchBatch,
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      recoverWorkbenchEventClaims,
      resolveWorkbenchBatch,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "post-write-crash",
      payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    });

    const terminalWrites: string[] = [];
    const first = await drainWorkbenchEvents("parent", async (batch) => {
      terminalWrites.push(batch.prompt);
    });
    const crashTime = new Date("2026-07-27T12:00:00.000Z");
    await prisma.workbenchBatch.update({
      where: { id: first.batchKey! },
      data: {
        state: "CLAIMED",
        dispatchAttempts: 0,
        dispatchedAt: null,
        leaseExpiresAt: new Date(crashTime.getTime() - 1),
      },
    });

    await expect(recoverWorkbenchEventClaims(crashTime)).resolves.toBe(1);
    const replay = await drainWorkbenchEvents("parent", async (batch) => {
      terminalWrites.push(batch.prompt);
    });

    expect(terminalWrites).toHaveLength(2);
    expect(replay.batchKey).toBe(first.batchKey);
    expect(replay.leaseToken).not.toBe(first.leaseToken);
    expect(await prisma.workbenchEvent.count({ where: { dedupKey: "post-write-crash" } })).toBe(1);
    expect(await prisma.taskMessage.count({ where: { id: first.batchKey! } })).toBe(1);
    await expect(acknowledgeWorkbenchBatch(replay.batchKey!, "parent", first.leaseToken!))
      .rejects.toThrow("lease token is stale");
    await acknowledgeWorkbenchBatch(replay.batchKey!, "parent", replay.leaseToken!);
    await resolveWorkbenchBatch(replay.batchKey!, "parent", replay.leaseToken!);
    expect(await prisma.workbenchEvent.count({ where: { state: "CONSUMED" } })).toBe(1);
  });

  it("recovers an ACKED batch when its processing lease expires", async () => {
    const {
      acknowledgeWorkbenchBatch,
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      recoverWorkbenchEventClaims,
      WORKBENCH_PROCESSING_LEASE_MS,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "acked-crash",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const result = await drainWorkbenchEvents("parent", async () => {});
    await acknowledgeWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!);
    const now = new Date("2026-07-27T12:00:00.000Z");
    await prisma.workbenchBatch.update({
      where: { id: result.batchKey! },
      data: {
        ackedAt: new Date(now.getTime() - WORKBENCH_PROCESSING_LEASE_MS - 1),
        leaseExpiresAt: new Date(now.getTime() - 1),
      },
    });

    await expect(recoverWorkbenchEventClaims(now)).resolves.toBe(1);
    expect(await prisma.workbenchBatch.findUniqueOrThrow({ where: { id: result.batchKey! } }))
      .toMatchObject({ state: "FAILED" });
    expect(await prisma.workbenchEvent.findFirstOrThrow({ where: { dedupKey: "acked-crash" } }))
      .toMatchObject({ state: "PENDING", batchId: null, consumedAt: null });
  });

  it("never revives a consumed event from a failed batch", async () => {
    const { drainWorkbenchEvents, enqueueWorkbenchEvent, recoverWorkbenchEventClaims } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "consumed-is-terminal",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const batch = await drainWorkbenchEvents("parent", async () => {});
    await prisma.workbenchEvent.updateMany({
      where: { batchId: batch.batchKey },
      data: { state: "CONSUMED", consumedAt: new Date() },
    });
    await prisma.workbenchBatch.update({
      where: { id: batch.batchKey! },
      data: { state: "FAILED", leaseExpiresAt: null },
    });

    await expect(recoverWorkbenchEventClaims()).resolves.toBe(0);
    expect(await prisma.workbenchEvent.findFirstOrThrow({ where: { dedupKey: "consumed-is-terminal" } }))
      .toMatchObject({ state: "CONSUMED", batchId: batch.batchKey });
  });

  it("rejects ACK and resolve callbacks from a stale delivery lease", async () => {
    const {
      acknowledgeWorkbenchBatch,
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
      resolveWorkbenchBatch,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "fenced-callback",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const result = await drainWorkbenchEvents("parent", async () => {});
    await expect(acknowledgeWorkbenchBatch(result.batchKey!, "parent", "stale"))
      .rejects.toThrow("lease token is stale");
    await acknowledgeWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!);
    await expect(resolveWorkbenchBatch(result.batchKey!, "parent", "stale"))
      .rejects.toThrow("lease token is stale");
    await expect(resolveWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!))
      .resolves.toMatchObject({ state: "RESOLVED", eventCount: 1 });
  });

  it("rejects a matching delivery token after its lease expires", async () => {
    const {
      acknowledgeWorkbenchBatch,
      drainWorkbenchEvents,
      enqueueWorkbenchEvent,
    } = await import("@/lib/workbench/coordinator");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "expired-callback",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const result = await drainWorkbenchEvents("parent", async () => {});
    await prisma.workbenchBatch.update({
      where: { id: result.batchKey! },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      acknowledgeWorkbenchBatch(result.batchKey!, "parent", result.leaseToken!),
    ).rejects.toThrow("lease has expired");
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
      executionId: "parent-exec",
    } as never);
    expect(restoreWorkbenchDrainBoundary("parent")).toBe(false);
    expect(hasWorkbenchDrainBoundary("parent")).toBe(false);

    vi.mocked(getSession).mockReturnValue({
      killed: false,
      isAtTurnBoundary: true,
    } as never);
    expect(restoreWorkbenchDrainBoundary("parent")).toBe(false);
    expect(hasWorkbenchDrainBoundary("parent")).toBe(false);

    vi.mocked(getSession).mockReturnValue({
      killed: false,
      isAtTurnBoundary: true,
      executionId: "parent-exec",
    } as never);
    expect(restoreWorkbenchDrainBoundary("parent")).toBe(true);
    expect(hasWorkbenchDrainBoundary("parent", "parent-exec")).toBe(true);

    resetWorkbenchDrainBoundariesForTests();
  });

  it("fences a restored live-session boundary against a replacement execution", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const {
      drainReadyWorkbenchParent,
      enqueueWorkbenchEvent,
      restoreWorkbenchDrainBoundary,
    } = await import("@/lib/workbench/coordinator");
    const { hasWorkbenchDrainBoundary } = await import("@/lib/workbench/boundary");
    vi.mocked(getSession).mockReturnValue({
      killed: false,
      isAtTurnBoundary: true,
      executionId: "parent-exec",
    } as never);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "restored-stale-execution-boundary",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });

    expect(restoreWorkbenchDrainBoundary("parent")).toBe(true);
    expect(hasWorkbenchDrainBoundary("parent", "parent-exec")).toBe(true);
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskExecution" SET "status" = 'COMPLETED', "endedAt" = CURRENT_TIMESTAMP WHERE "id" = 'parent-exec'`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('parent-exec-2', 'parent', 'RUNNING')`,
    );
    const deliver = vi.fn(async () => undefined);

    await drainReadyWorkbenchParent("parent", deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(hasWorkbenchDrainBoundary("parent")).toBe(false);
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "PENDING" });
  });

  it.each(["continued", "started"] as const)(
    "drains pending work after a %s Workbench starts without provider input",
    async (mode) => {
      const { getSession } = await import("@/lib/pty/session-store");
      const {
        drainReadyWorkbenchParent,
        enqueueWorkbenchEvent,
        reconcilePendingWorkbenchEvents,
      } = await import("@/lib/workbench/coordinator");
      const { hasWorkbenchDrainBoundary } = await import("@/lib/workbench/boundary");
      vi.mocked(getSession).mockReturnValue(undefined);
      await prisma.taskExecution.updateMany({
        where: { taskId: "parent" },
        data: { status: "FAILED", endedAt: new Date() },
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('parent-exec-2', 'parent', 'RUNNING')`,
      );
      await enqueueWorkbenchEvent({
        parentTaskId: "parent",
        sourceTaskId: "child-a",
        kind: "CHILD_REVIEW_REQUIRED",
        dedupKey: `reconcile-ready-${mode}`,
        payload: { childTaskId: "child-a", childTitle: "Child A" },
      });
      const ensure = vi.fn(async () => ({
        mode,
        executionId: "parent-exec-2",
        startsAtInputBoundary: true,
      }));

      await expect(reconcilePendingWorkbenchEvents(ensure)).resolves.toEqual({
        scanned: 1,
        woken: 1,
        busy: 0,
        failed: 0,
      });
      expect(hasWorkbenchDrainBoundary("parent", "parent-exec-2")).toBe(true);

      const deliveries: string[] = [];
      await drainReadyWorkbenchParent("parent", async (batch) => {
        deliveries.push(batch.prompt);
      });
      expect(deliveries).toHaveLength(1);
      expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "PROCESSING" });
      expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
        .toMatchObject({ executionId: "parent-exec-2", state: "BUSY" });
    },
  );

  it.each(["continued", "started"] as const)(
    "keeps a %s Workbench with startup input fenced until provider completion",
    async (mode) => {
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
        mode,
        executionId: "parent-exec-2",
        startsAtInputBoundary: false,
      }));

      await expect(reconcilePendingWorkbenchEvents(ensure)).resolves.toEqual({
        scanned: 1,
        woken: 0,
        busy: 1,
        failed: 0,
      });
      expect(ensure).toHaveBeenCalledWith("parent");
      expect(hasWorkbenchDrainBoundary("parent")).toBe(false);
      expect(await prisma.workbenchRuntime.findUnique({ where: { taskId: "parent" } }))
        .toMatchObject({
          executionId: "parent-exec-2",
          state: "STARTING",
          pendingEvents: 1,
        });
    },
  );

  it("does not let an old execution boundary unlock the current Workbench", async () => {
    const {
      drainReadyWorkbenchParent,
      enqueueWorkbenchEvent,
      openWorkbenchDrainBoundary,
    } = await import("@/lib/workbench/coordinator");
    const { hasWorkbenchDrainBoundary } = await import("@/lib/workbench/boundary");
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "stale-execution-boundary",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    openWorkbenchDrainBoundary("parent", "parent-exec");
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskExecution" SET "status" = 'COMPLETED', "endedAt" = CURRENT_TIMESTAMP WHERE "id" = 'parent-exec'`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('parent-exec-2', 'parent', 'RUNNING')`,
    );
    const deliver = vi.fn(async () => undefined);

    await drainReadyWorkbenchParent("parent", deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(hasWorkbenchDrainBoundary("parent")).toBe(false);
    expect(await prisma.workbenchEvent.findFirst()).toMatchObject({ state: "PENDING" });
  });

  it("refuses to write a claimed batch into a replacement PTY execution", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const { deliverWorkbenchBatchToParent } = await import("@/lib/workbench/coordinator");
    const writeRaw = vi.fn();
    const writeSubmittedInput = vi.fn();
    vi.mocked(getSession).mockReturnValue({
      killed: false,
      executionId: "parent-exec-2",
      writeRaw,
      writeSubmittedInput,
    } as never);

    await expect(deliverWorkbenchBatchToParent({
      batchKey: "old-execution-batch",
      generation: 1,
      leaseToken: "lease",
      parentTaskId: "parent",
      parentExecutionId: "parent-exec",
      eventIds: [],
      events: [],
      prompt: "must not be delivered",
    })).rejects.toThrow("different execution");
    expect(writeRaw).not.toHaveBeenCalled();
    expect(writeSubmittedInput).not.toHaveBeenCalled();
  });

  it("backs off a failed Workbench restart instead of retrying every scanner tick", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const {
      enqueueWorkbenchEvent,
      reconcilePendingWorkbenchEvents,
      WORKBENCH_RECONCILE_FAILURE_BACKOFF_MS,
    } = await import("@/lib/workbench/coordinator");
    vi.mocked(getSession).mockReturnValue(undefined);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "reconcile-failed-parent",
      payload: { childTaskId: "child-a", childTitle: "Child A" },
    });
    const ensure = vi.fn()
      .mockRejectedValueOnce(new Error("Project has no local path configured"))
      .mockResolvedValue({ mode: "continued" as const, executionId: "parent-exec-2" });
    const startedAt = new Date();

    await expect(reconcilePendingWorkbenchEvents(ensure, startedAt)).resolves.toEqual({
      scanned: 1,
      woken: 0,
      busy: 0,
      failed: 1,
    });
    await expect(reconcilePendingWorkbenchEvents(ensure, startedAt)).resolves.toEqual({
      scanned: 0,
      woken: 0,
      busy: 0,
      failed: 0,
    });
    expect(ensure).toHaveBeenCalledTimes(1);

    await expect(reconcilePendingWorkbenchEvents(
      ensure,
      new Date(startedAt.getTime() + WORKBENCH_RECONCILE_FAILURE_BACKOFF_MS + 1_000),
    )).resolves.toEqual({
      scanned: 1,
      woken: 0,
      busy: 1,
      failed: 0,
    });
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it("drains queued Gateway work automatically at a provider-confirmed boundary", async () => {
    const {
      drainReadyWorkbenchParent,
      enqueueWorkbenchEvent,
      openWorkbenchDrainBoundary,
    } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(`INSERT INTO "GatewayInbound" ("id", "state") VALUES ('gateway-backlog', 'QUEUED')`);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "GATEWAY_WORK_REQUEST",
      dedupKey: "gateway-work:gateway-backlog",
      payload: {
        childTaskId: "parent",
        childTitle: "Gateway backlog",
        instruction: "Create the queued task.",
        sourceReference: { namespace: "gateway_inbound", id: "gateway-backlog" },
      },
    });
    const deliveries: string[] = [];

    openWorkbenchDrainBoundary("parent");
    await drainReadyWorkbenchParent("parent", async (batch) => {
      deliveries.push(batch.prompt);
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toContain("Create the queued task.");
    expect(await prisma.workbenchEvent.findFirst({ where: { dedupKey: "gateway-work:gateway-backlog" } }))
      .toMatchObject({ state: "PROCESSING" });
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

  it("coalesces accumulated review turns from the same child execution", async () => {
    const { drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('child-exec', 'child-a', 'RUNNING')`,
    );
    for (const [dedupKey, childReply] of [["turn-1", "old"], ["turn-2", "latest"]] as const) {
      await enqueueWorkbenchEvent({
        parentTaskId: "parent",
        sourceTaskId: "child-a",
        executionId: "child-exec",
        kind: "CHILD_REVIEW_REQUIRED",
        dedupKey,
        reviewProducer: "STOP_HOOK",
        payload: { childTaskId: "child-a", childTitle: "Child A", childReply },
      });
    }
    const delivered: WorkbenchDrainBatch[] = [];

    await expect(drainWorkbenchEvents("parent", async (batch) => {
      delivered.push(batch);
    })).resolves.toMatchObject({ eventCount: 1, delivered: true });

    expect(delivered[0].events).toHaveLength(1);
    expect(delivered[0].prompt).toContain("latest");
    expect(delivered[0].prompt).not.toContain("old");
    expect(await prisma.workbenchEvent.findUnique({ where: { dedupKey: "turn-1" } }))
      .toMatchObject({ state: "CONSUMED", batchId: null });
    expect(await prisma.workbenchEvent.findUnique({ where: { dedupKey: "turn-2" } }))
      .toMatchObject({ state: "PROCESSING" });
  });

  it("discards pending reviews after the child task is terminal", async () => {
    const { drainWorkbenchEvents, enqueueWorkbenchEvent } = await import("@/lib/workbench/coordinator");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskExecution" ("id", "taskId", "status") VALUES ('child-exec', 'child-a', 'COMPLETED')`,
    );
    await prisma.$executeRawUnsafe(`UPDATE "Task" SET "status" = 'DONE' WHERE "id" = 'child-a'`);
    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "child-a",
      executionId: "child-exec",
      kind: "CHILD_REVIEW_REQUIRED",
      dedupKey: "stale-review",
      reviewProducer: "STOP_HOOK",
      payload: { childTaskId: "child-a", childTitle: "Child A", childReply: "done" },
    });
    const deliver = vi.fn();

    await expect(drainWorkbenchEvents("parent", deliver)).resolves.toEqual({
      eventCount: 0,
      delivered: false,
    });

    expect(deliver).not.toHaveBeenCalled();
    expect(await prisma.workbenchEvent.findUnique({ where: { dedupKey: "stale-review" } }))
      .toMatchObject({ state: "CONSUMED", batchId: null });
  });

  it("recovers a missed Codex completion boundary from the durable transcript", async () => {
    const { getSession, markSessionTurnComplete } = await import("@/lib/pty/session-store");
    const { hasWorkbenchDrainBoundary } = await import("@/lib/workbench/boundary");
    const { restoreWorkbenchBoundaryFromProviderTranscript } = await import("@/lib/workbench/coordinator");
    vi.mocked(getSession).mockReturnValue({ killed: false } as never);
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskExecution" SET "agent" = 'CODEX_CLI', "sessionId" = 'codex-thread' WHERE "id" = 'parent-exec'`,
    );
    const sessionsDir = join(tempDirs[0], "codex-sessions");
    const dayDir = join(sessionsDir, "2026", "08", "05");
    await mkdir(dayDir, { recursive: true });
    await writeFile(join(dayDir, "rollout-2026-08-05T10-00-00-codex-thread.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-05T10:00:00.000Z", type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({ timestamp: "2026-08-05T10:01:00.000Z", type: "event_msg", payload: { type: "task_complete" } }),
      "",
    ].join("\n"));

    await expect(restoreWorkbenchBoundaryFromProviderTranscript("parent", { codexSessionsDir: sessionsDir }))
      .resolves.toBe(true);

    expect(markSessionTurnComplete).toHaveBeenCalledWith("parent");
    expect(hasWorkbenchDrainBoundary("parent", "parent-exec")).toBe(true);
  });

  it("drains a queued Gateway discussion after xterm protocol bytes follow durable Codex completion", async () => {
    const { getSession } = await import("@/lib/pty/session-store");
    const { forwardTerminalClientMessage } = await import("@/lib/pty/ws-server");
    const { encodeTerminalClientInput } = await import("@/lib/pty/ws-input-protocol");
    const {
      drainReadyWorkbenchParent,
      enqueueWorkbenchEvent,
      reconcilePendingWorkbenchEvents,
    } = await import("@/lib/workbench/coordinator");
    const live = {
      killed: false,
      executionId: "parent-exec",
      isAtTurnBoundary: false,
      lastInputAt: null,
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeSubmittedInput: vi.fn(),
    };
    vi.mocked(getSession).mockReturnValue(live as never);
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskExecution" SET "agent" = 'CODEX_CLI', "sessionId" = 'codex-thread' WHERE "id" = 'parent-exec'`,
    );
    const sessionsDir = join(tempDirs[0], "codex-sessions-gateway-discussion");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "rollout-codex-thread.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-06T10:30:00.000Z", type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({ timestamp: "2026-08-06T10:30:59.000Z", type: "event_msg", payload: { type: "task_complete" } }),
      "",
    ].join("\n"));

    for (const bytes of ["\x1b[I", "\x1b[O", "\x1b[12;40R", "\x1b[?1;2c"]) {
      forwardTerminalClientMessage(live, encodeTerminalClientInput(bytes));
    }
    expect(live.writeRaw).toHaveBeenCalledTimes(4);
    expect(live.writeSubmittedInput).not.toHaveBeenCalled();
    expect(live.lastInputAt).toBeNull();

    await enqueueWorkbenchEvent({
      parentTaskId: "parent",
      sourceTaskId: "parent",
      kind: "GATEWAY_DISCUSSION_REQUEST",
      dedupKey: "gateway-discussion:cmsgwkn5e0015cpchjr40dz27",
      payload: {
        childTaskId: "parent",
        childTitle: "Gateway discussion",
        instruction: "[Gateway project discussion request]\nExplain the current state.",
      },
    });

    await expect(reconcilePendingWorkbenchEvents(
      vi.fn(),
      new Date("2026-08-06T10:34:45.000Z"),
      { codexSessionsDir: sessionsDir },
    )).resolves.toEqual({ scanned: 1, woken: 1, busy: 0, failed: 0 });

    const delivered: WorkbenchDrainBatch[] = [];
    await drainReadyWorkbenchParent("parent", async (batch) => {
      delivered.push(batch);
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0].prompt).toContain("Explain the current state.");
    expect(await prisma.workbenchEvent.findUnique({
      where: { dedupKey: "gateway-discussion:cmsgwkn5e0015cpchjr40dz27" },
    })).toMatchObject({ state: "PROCESSING" });
  });

  it("does not restore an old Codex completion after a real user submit", async () => {
    const { getSession, markSessionTurnComplete } = await import("@/lib/pty/session-store");
    const { forwardTerminalClientMessage } = await import("@/lib/pty/ws-server");
    const { encodeTerminalClientInput } = await import("@/lib/pty/ws-input-protocol");
    const { restoreWorkbenchBoundaryFromProviderTranscript } = await import("@/lib/workbench/coordinator");
    let lastInputAt = 0;
    const live = {
      killed: false,
      get lastInputAt() {
        return lastInputAt;
      },
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeSubmittedInput: vi.fn(() => {
        lastInputAt = Date.parse("2026-08-05T10:02:00.000Z");
      }),
    };
    vi.mocked(getSession).mockReturnValue(live as never);
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskExecution" SET "agent" = 'CODEX_CLI', "sessionId" = 'codex-thread' WHERE "id" = 'parent-exec'`,
    );
    const sessionsDir = join(tempDirs[0], "codex-sessions-stale");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "rollout-codex-thread.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-05T10:00:00.000Z", type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({ timestamp: "2026-08-05T10:01:00.000Z", type: "event_msg", payload: { type: "task_complete" } }),
      "",
    ].join("\n"));

    forwardTerminalClientMessage(live, encodeTerminalClientInput("\r"));
    expect(live.writeSubmittedInput).toHaveBeenCalledWith("\r");

    await expect(restoreWorkbenchBoundaryFromProviderTranscript("parent", { codexSessionsDir: sessionsDir }))
      .resolves.toBe(false);

    expect(markSessionTurnComplete).not.toHaveBeenCalled();
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
