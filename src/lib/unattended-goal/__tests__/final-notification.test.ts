// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { up as addGoalRuntime } from "../../../../scripts/migrations/0029-unattended-goal-runtime";
import { up as addCapabilities } from "../../../../scripts/migrations/0030-capability-runtime";
import { up as addCapabilityResultWakeup } from "../../../../scripts/migrations/0031-capability-result-wakeup";
import { up as addGoalPolicy } from "../../../../scripts/migrations/0032-unattended-goal-policy";
import { up as addCapabilityCompletionCallback } from "../../../../scripts/migrations/0033-capability-completion-callback";
import { up as addFinalNotification } from "../../../../scripts/migrations/0036-unattended-final-notification";

const mocks = vi.hoisted(() => ({
  outbound: vi.fn(),
  target: vi.fn(),
  setSignal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/harness/harness-outbound", () => ({ enqueueHarnessOutbound: mocks.outbound }));
vi.mock("@/lib/gateway/capability-target", () => ({ readOwnerHomeTarget: mocks.target }));
vi.mock("@/lib/harness/unattended-signal", () => ({ setUnattendedSignal: mocks.setSignal }));

import { issueOwnerMessageGrant } from "@/lib/gateway/capability-grants";
import { submitCapabilityRequest } from "@/lib/gateway/capability-runtime";
import {
  ensureUnattendedGoalFinalNotification,
  recoverUnattendedGoalFinalNotification,
  reconcileUnattendedGoalFinalNotifications,
} from "../final-notification";
import { activateUnattendedGoal, endUnattendedGoalIfActive } from "../runtime";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database(): Promise<PrismaClient> {
  const directory = await mkdtemp(join(tmpdir(), "tower-final-notification-"));
  directories.push(directory);
  const client = new PrismaClient({ datasourceUrl: `file:${join(directory, "goal.db")}` });
  clients.push(client);
  await client.$executeRawUnsafe(`
    CREATE TABLE "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      "projectId" TEXT NOT NULL,
      "parentTaskId" TEXT,
      "unattended" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "TaskExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "summary" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addGoalRuntime(client);
  await addCapabilities(client);
  await addCapabilityResultWakeup(client);
  await addGoalPolicy(client);
  await addCapabilityCompletionCallback(client);
  await addFinalNotification(client);
  await client.$executeRawUnsafe(`
    INSERT INTO "Task" ("id", "title", "projectId")
    VALUES ('goal-1', 'Ship release', 'project-1'), ('child-1', 'Child task', 'project-1')
  `);
  await client.$executeRawUnsafe(`
    INSERT INTO "TaskExecution" ("id", "taskId", "summary")
    VALUES ('execution-1', 'goal-1', 'Release checks passed')
  `);
  await activateUnattendedGoal(client as never, "goal-1");
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.target.mockResolvedValue({
    id: "owner-route",
    gateway: "openclaw",
    downstream: "feishu",
    dest: "feishu:owner",
    fingerprint: "owner-route-v1",
  });
  mocks.outbound.mockResolvedValue({
    outboundId: "outbound-1",
    state: "DELIVERED",
    deduped: false,
    sent: true,
    parked: true,
    platformMessageId: "message-1",
    lastError: null,
  });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("unattended Goal final notification", () => {
  it("persists and delivers one final notification across duplicate lifecycle callbacks", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "goal-1", maxUses: 2 }, prisma as never);

    const first = await ensureUnattendedGoalFinalNotification({
      taskId: "goal-1",
      kind: "COMPLETED",
      lifecycleEvent: "TERMINAL_COMPLETED",
    }, prisma);
    const duplicate = await ensureUnattendedGoalFinalNotification({
      taskId: "goal-1",
      kind: "COMPLETED",
      lifecycleEvent: "TERMINAL_COMPLETED",
    }, prisma);

    expect(first).toMatchObject({ state: "SUCCEEDED", runtimeState: "ENDED" });
    expect(duplicate).toMatchObject({ requestId: first?.requestId, state: "SUCCEEDED" });
    expect(await prisma.capabilityRequest.count({ where: { taskId: "goal-1" } })).toBe(1);
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
    expect(await prisma.capabilityGrant.findUniqueOrThrow({ where: { id: grant.authorizationRef } }))
      .toMatchObject({ usedCount: 1, revokedAt: expect.any(Date) });
    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({
        state: "ENDED",
        ownerNotificationKind: "COMPLETED",
        ownerNotificationState: "SUCCEEDED",
        ownerNotificationSummary: expect.stringContaining("Release checks passed"),
        ownerNotificationBinding: "[[tower:task=goal-1]]",
      });
  });

  it("adopts an agent-sent terminal CapabilityRequest instead of sending a duplicate", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "goal-1", maxUses: 2 }, prisma as never);
    const requestId = "9f34172c-62bf-4c68-9bca-66e7f6711bb5";
    await submitCapabilityRequest({
      schemaVersion: 1,
      requestId,
      capability: "human.message.send",
      lane: "DIRECT",
      risk: "R2",
      authorizationRef: grant.authorizationRef,
      inputs: { message: "Goal complete", expectReply: true, goalTerminal: "COMPLETED" },
      expectedOutput: { summary: true, evidence: [] },
      towerContext: { taskId: "goal-1" },
      constraints: [],
    }, prisma as never);
    await expect(submitCapabilityRequest({
      schemaVersion: 1,
      requestId: "f7ecf288-2a94-45c8-bb92-82489c5fb973",
      capability: "human.message.send",
      lane: "DIRECT",
      risk: "R2",
      authorizationRef: grant.authorizationRef,
      inputs: { message: "Duplicate final", expectReply: true, goalTerminal: "COMPLETED" },
      expectedOutput: { summary: true, evidence: [] },
      towerContext: { taskId: "goal-1" },
      constraints: [],
    }, prisma as never)).rejects.toThrow(/stable requestId/);

    const result = await ensureUnattendedGoalFinalNotification({
      taskId: "goal-1",
      kind: "COMPLETED",
      lifecycleEvent: "TERMINAL_COMPLETED",
    }, prisma);

    expect(result).toMatchObject({ requestId, state: "SUCCEEDED" });
    expect(await prisma.capabilityRequest.count({ where: { taskId: "goal-1" } })).toBe(1);
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
  });

  it("keeps an expired-authorization failure visible and recovers the same persisted intent", async () => {
    const prisma = await database();
    const blocked = await ensureUnattendedGoalFinalNotification({
      taskId: "goal-1",
      kind: "COMPLETED",
      lifecycleEvent: "TERMINAL_COMPLETED",
    }, prisma);

    expect(blocked).toMatchObject({ state: "BLOCKED", runtimeState: "BLOCKED" });
    expect(await prisma.capabilityRequest.count()).toBe(0);
    const requestId = blocked!.requestId;
    await issueOwnerMessageGrant({ taskId: "goal-1", maxUses: 1 }, prisma as never);
    const recovered = await recoverUnattendedGoalFinalNotification("goal-1", prisma, true);

    expect(recovered).toMatchObject({ requestId, state: "SUCCEEDED", runtimeState: "ENDED" });
    expect(await prisma.capabilityRequest.count()).toBe(1);
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
  });

  it("never retries SIDE_EFFECT_UNKNOWN automatically or through explicit recovery", async () => {
    const prisma = await database();
    await issueOwnerMessageGrant({ taskId: "goal-1", maxUses: 1 }, prisma as never);
    mocks.outbound.mockResolvedValueOnce({
      outboundId: "outbound-unknown",
      state: "SENT_UNVERIFIED",
      deduped: false,
      sent: true,
      parked: false,
      platformMessageId: null,
      lastError: "sender crashed",
    });
    const result = await ensureUnattendedGoalFinalNotification({
      taskId: "goal-1",
      kind: "COMPLETED",
      lifecycleEvent: "TERMINAL_COMPLETED",
    }, prisma);

    expect(result).toMatchObject({ state: "SIDE_EFFECT_UNKNOWN", runtimeState: "BLOCKED" });
    await expect(reconcileUnattendedGoalFinalNotifications(prisma)).resolves.toEqual({ scanned: 0, recovered: 0 });
    await recoverUnattendedGoalFinalNotification("goal-1", prisma, true);
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
  });

  it("does not create OWNER noise for an ordinary child without an active Goal runtime", async () => {
    const prisma = await database();

    await expect(ensureUnattendedGoalFinalNotification({
      taskId: "child-1",
      kind: "COMPLETED",
      lifecycleEvent: "TERMINAL_COMPLETED",
    }, prisma)).resolves.toBeNull();

    expect(await prisma.capabilityRequest.count({ where: { taskId: "child-1" } })).toBe(0);
    expect(mocks.outbound).not.toHaveBeenCalled();
  });

  it.each([
    ["TERMINAL_COMPLETED", "IN_REVIEW"],
    ["TERMINAL_STOPPED", "IN_REVIEW"],
    ["TASK_LEFT_ACTIVE_LOOP", "IN_REVIEW"],
    ["TASK_LEFT_ACTIVE_LOOP", "DONE"],
    ["TASK_LEFT_ACTIVE_LOOP", "CANCELLED"],
  ] as const)("closes %s from task status %s through the same final-notification boundary", async (event, status) => {
    const prisma = await database();
    await prisma.$executeRawUnsafe(`UPDATE "Task" SET "status" = ? WHERE "id" = 'goal-1'`, status);
    await issueOwnerMessageGrant({ taskId: "goal-1", maxUses: 1 }, prisma as never);

    await endUnattendedGoalIfActive(prisma as never, "goal-1", event);

    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({ state: "ENDED", ownerNotificationState: "SUCCEEDED" });
    expect(await prisma.capabilityRequest.count({ where: { taskId: "goal-1" } })).toBe(1);
  });

  it("parks a failed terminal as BLOCKED after notifying the OWNER", async () => {
    const prisma = await database();
    await issueOwnerMessageGrant({ taskId: "goal-1", maxUses: 1 }, prisma as never);

    await endUnattendedGoalIfActive(prisma as never, "goal-1", "TERMINAL_FAILED");

    expect(await prisma.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId: "goal-1" } }))
      .toMatchObject({
        state: "BLOCKED",
        ownerNotificationKind: "BLOCKED",
        ownerNotificationState: "SUCCEEDED",
      });
  });
});
