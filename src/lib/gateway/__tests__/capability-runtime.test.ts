// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { up as addWorkbenchEvents } from "../../../../scripts/migrations/0014-workbench-events";
import { up as addWorkbenchReviewKey } from "../../../../scripts/migrations/0015-workbench-execution-review-key";
import { up as addWorkbenchBatchAck } from "../../../../scripts/migrations/0021-workbench-batch-ack";
import { up as addGoalRuntime } from "../../../../scripts/migrations/0029-unattended-goal-runtime";
import { up } from "../../../../scripts/migrations/0030-capability-runtime";
import { up as addResultWakeup } from "../../../../scripts/migrations/0031-capability-result-wakeup";
import { up as addGoalPolicy } from "../../../../scripts/migrations/0032-unattended-goal-policy";
import { up as addCompletionCallback } from "../../../../scripts/migrations/0033-capability-completion-callback";

const mocks = vi.hoisted(() => ({
  outbound: vi.fn(),
  target: vi.fn(),
  discoverJobs: vi.fn(),
  submitJob: vi.fn(),
  readJob: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/harness/harness-outbound", () => ({ enqueueHarnessOutbound: mocks.outbound }));
vi.mock("../capability-target", () => ({ readOwnerHomeTarget: mocks.target }));
vi.mock("../openclaw-capability-client", () => ({
  discoverOpenClawCapabilities: mocks.discoverJobs,
  submitOpenClawCapabilityJob: mocks.submitJob,
}));
vi.mock("../openclaw-task-client", () => ({ readOpenClawCapabilityJob: mocks.readJob }));
vi.mock("@/lib/harness/gateway-config", () => ({
  readHarnessGatewayRuntimeConfig: vi.fn(async () => ({ env: {} })),
}));

import { issueCapabilityGrants, issueOwnerMessageGrant } from "../capability-grants";
import {
  applyCapabilityJobSnapshot,
  discoverGatewayCapabilities,
  reconcileCapabilityCompletion,
  recoverPendingCapabilityRequests,
  submitCapabilityRequest,
} from "../capability-runtime";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database(): Promise<PrismaClient> {
  const directory = await mkdtemp(join(tmpdir(), "tower-capability-runtime-"));
  directories.push(directory);
  const client = new PrismaClient({ datasourceUrl: `file:${join(directory, "capability.db")}` });
  clients.push(client);
  await client.$executeRawUnsafe(`
    CREATE TABLE "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "unattended" INTEGER NOT NULL DEFAULT 0,
      "parentTaskId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  await client.$executeRawUnsafe(`
    CREATE TABLE "WorkbenchBatch" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "parentTaskId" TEXT NOT NULL,
      "state" TEXT NOT NULL,
      "leaseExpiresAt" DATETIME
    )
  `);
  await addWorkbenchEvents(client);
  await addWorkbenchReviewKey(client);
  await addWorkbenchBatchAck(client);
  await addGoalRuntime(client);
  await up(client);
  await addResultWakeup(client);
  await addGoalPolicy(client);
  await addCompletionCallback(client);
  await client.$executeRawUnsafe(
    `INSERT INTO "Task" ("id", "title", "projectId") VALUES ('task-1', 'Unattended task', 'project-1')`,
  );
  await client.unattendedGoalRuntime.create({
    data: {
      taskId: "task-1",
      state: "ACTIVE",
      lastEventKind: "ACTIVATED",
      activatedAt: new Date(),
    },
  });
  return client;
}

function envelope(authorizationRef: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: "5aa1ee1a-f6d7-48a7-a9eb-e624122fc931",
    capability: "human.message.send",
    lane: "DIRECT",
    risk: "R2",
    authorizationRef,
    inputs: { message: "Need a decision", expectReply: true },
    expectedOutput: { summary: true, evidence: [] },
    towerContext: { taskId: "task-1" },
    constraints: [],
    ...overrides,
  };
}

function jobEnvelope(authorizationRef: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: "4cc2791f-fbc9-47af-b410-4bd0586ae941",
    capability: "computer.gui.act",
    lane: "JOB",
    risk: "R2",
    authorizationRef,
    inputs: { instruction: "Open the report" },
    expectedOutput: { summary: true, evidence: [] },
    towerContext: { taskId: "task-1" },
    constraints: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.target.mockResolvedValue({
    id: "owner-route",
    gateway: "openclaw",
    downstream: "feishu",
    dest: "feishu:oc_owner",
    fingerprint: "target-fingerprint",
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
  mocks.discoverJobs.mockResolvedValue([]);
  mocks.submitJob.mockResolvedValue({
    requestId: "4cc2791f-fbc9-47af-b410-4bd0586ae941",
    jobRef: "openclaw-run-1",
    runId: "openclaw-run-1",
    status: "ACCEPTED",
    revision: "2026-08-02T00:00:00.000Z",
  });
  mocks.readJob.mockResolvedValue({
    gateway: "openclaw",
    requestedRef: "openclaw-run-1",
    jobRef: "openclaw-task-1",
    runId: "openclaw-run-1",
    status: "SUCCEEDED",
    revision: "1785628800000",
    updatedAt: "2026-08-02T00:00:00.000Z",
    summary: "Report opened",
  });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Gateway capability runtime", () => {
  it("requires a UI-issued grant and does not expose the OWNER destination in discovery", async () => {
    const prisma = await database();
    const before = await discoverGatewayCapabilities("task-1", prisma);
    expect(before.capabilities[0]).toMatchObject({ available: true, authorization: { authorizationRef: null } });
    expect(JSON.stringify(before)).not.toContain("oc_owner");

    const grant = await issueOwnerMessageGrant({ taskId: "task-1", maxUses: 2 }, prisma);
    const after = await discoverGatewayCapabilities("task-1", prisma);
    expect(after.capabilities[0].authorization).toMatchObject({
      authorizationRef: grant.authorizationRef,
      remainingUses: 2,
    });

    await expect(submitCapabilityRequest(envelope("invented-grant"), prisma))
      .rejects.toThrow(/valid bounded OWNER authorization/);
  });

  it("does not expose or accept a stale grant after the unattended Goal ends", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "task-1", maxUses: 2 }, prisma);
    await prisma.unattendedGoalRuntime.update({
      where: { taskId: "task-1" },
      data: { state: "ENDED", endedAt: new Date(), lastEventKind: "TERMINAL_COMPLETED" },
    });

    const discovery = await discoverGatewayCapabilities("task-1", prisma);
    expect(discovery.capabilities[0].authorization.authorizationRef).toBeNull();
    await expect(submitCapabilityRequest(envelope(grant.authorizationRef), prisma))
      .rejects.toThrow(/active unattended Goal/);
    expect(await prisma.capabilityGrant.findUniqueOrThrow({ where: { id: grant.authorizationRef } }))
      .toMatchObject({ usedCount: 0, revokedAt: null });
    expect(mocks.outbound).not.toHaveBeenCalled();
  });

  it("keeps the bounded OWNER notification path available while a Goal is BLOCKED", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "task-1", maxUses: 1 }, prisma);
    await prisma.unattendedGoalRuntime.update({
      where: { taskId: "task-1" },
      data: {
        state: "BLOCKED",
        blockedAt: new Date(),
        blockedReason: "MAX_DURATION",
        lastEventKind: "BUDGET_BLOCKED",
      },
    });

    const discovery = await discoverGatewayCapabilities("task-1", prisma);
    expect(discovery.capabilities[0].authorization.authorizationRef).toBe(grant.authorizationRef);
    await expect(submitCapabilityRequest(envelope(grant.authorizationRef), prisma))
      .resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
  });

  it("delivers once for one requestId and rejects payload mutation", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "task-1", maxUses: 2 }, prisma);
    const request = envelope(grant.authorizationRef);

    await expect(submitCapabilityRequest(request, prisma)).resolves.toMatchObject({
      status: "SUCCEEDED",
      summary: "Message delivered to the OWNER home route",
      evidence: ["gateway-message:message-1"],
    });
    await expect(submitCapabilityRequest(request, prisma)).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
    expect(mocks.outbound).toHaveBeenCalledWith(expect.objectContaining({
      dedupKey: `capability:${request.requestId}`,
      dest: "feishu:oc_owner",
      requestedTo: null,
    }));
    const storedGrant = await prisma.capabilityGrant.findUniqueOrThrow({ where: { id: grant.authorizationRef } });
    expect(storedGrant.usedCount).toBe(1);

    await expect(submitCapabilityRequest({
      ...request,
      inputs: { message: "Changed after acceptance", expectReply: true },
    }, prisma)).rejects.toThrow(/different capability request/);
  });

  it("maps uncertain sends terminally and never replays them during recovery", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "task-1" }, prisma);
    mocks.outbound.mockResolvedValueOnce({
      outboundId: "outbound-unknown",
      state: "SENT_UNVERIFIED",
      deduped: false,
      sent: true,
      parked: false,
      platformMessageId: null,
      lastError: "sender crashed",
    });

    await expect(submitCapabilityRequest(envelope(grant.authorizationRef), prisma)).resolves.toMatchObject({
      status: "SIDE_EFFECT_UNKNOWN",
    });
    await expect(recoverPendingCapabilityRequests(25, prisma)).resolves.toEqual({
      scanned: 0,
      recovered: 0,
      blocked: 0,
    });
    expect(mocks.outbound).toHaveBeenCalledTimes(1);
  });

  it("blocks an accepted request when the fixed OWNER route changes before dispatch", async () => {
    const prisma = await database();
    const grant = await issueOwnerMessageGrant({ taskId: "task-1" }, prisma);
    await prisma.capabilityRequest.create({
      data: {
        requestId: "f40d49ca-f356-49c6-8b58-88e4055cdd44",
        taskId: "task-1",
        capability: "human.message.send",
        lane: "DIRECT",
        risk: "R2",
        authorizationRef: grant.authorizationRef,
        inputDigest: "digest",
        inputsJson: JSON.stringify({ message: "hello" }),
      },
    });
    mocks.target.mockResolvedValue({
      id: "different-route",
      gateway: "openclaw",
      downstream: "feishu",
      dest: "feishu:oc_other",
      fingerprint: "different-fingerprint",
    });

    await expect(recoverPendingCapabilityRequests(25, prisma)).resolves.toEqual({
      scanned: 1,
      recovered: 0,
      blocked: 1,
    });
    expect(mocks.outbound).not.toHaveBeenCalled();
  });

  it("submits an advertised Job once and reconciles from OpenClaw task state", async () => {
    const prisma = await database();
    mocks.discoverJobs.mockResolvedValue([{
      capability: "computer.gui.act",
      description: "Operate the desktop",
      lane: "JOB",
      risk: "R2",
      available: true,
      availability: "CONFIGURED",
      gateway: "openclaw",
      routeRevision: "operator-route-v1",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["instruction"],
        properties: { instruction: { type: "string", minLength: 1 } },
      },
      outputSchema: { type: "object" },
    }]);
    const [grant] = await issueCapabilityGrants({
      taskId: "task-1",
      targets: [{
        capability: "computer.gui.act",
        risk: "R2",
        targetKind: "GATEWAY_CAPABILITY_ROUTE",
        targetFingerprint: "operator-route-v1",
      }],
    }, prisma);

    await expect(submitCapabilityRequest(jobEnvelope(grant.authorizationRef), prisma)).resolves.toMatchObject({
      status: "ACCEPTED",
      gateway: "openclaw",
      jobRef: "openclaw-run-1",
    });
    const submission = mocks.submitJob.mock.calls[0]?.[0] as {
      callback: { url: string; token: string };
    };
    expect(submission.callback).toMatchObject({
      url: "http://127.0.0.1:3000/api/internal/harness/capabilities/completions",
      token: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
    });
    await expect(reconcileCapabilityCompletion({
      requestId: "4cc2791f-fbc9-47af-b410-4bd0586ae941",
      runId: "openclaw-run-1",
      callbackToken: submission.callback.token,
    }, prisma)).resolves.toMatchObject({
      status: "SUCCEEDED",
      summary: "Report opened",
      evidence: ["openclaw-task:openclaw-task-1"],
    });
    expect(mocks.submitJob).toHaveBeenCalledTimes(1);
    expect(mocks.submitJob).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "4cc2791f-fbc9-47af-b410-4bd0586ae941",
      capability: "computer.gui.act",
      inputs: { instruction: "Open the report" },
      towerContext: { taskId: "task-1", projectId: "project-1" },
      callback: expect.objectContaining({
        url: "http://127.0.0.1:3000/api/internal/harness/capabilities/completions",
      }),
    }), {});
    expect(await prisma.workbenchEvent.findUniqueOrThrow({
      where: { dedupKey: "capability-result:4cc2791f-fbc9-47af-b410-4bd0586ae941:1785628800000" },
    })).toMatchObject({
      parentTaskId: "task-1",
      sourceTaskId: "task-1",
      kind: "CAPABILITY_RESULT_AVAILABLE",
      dedupKey: "capability-result:4cc2791f-fbc9-47af-b410-4bd0586ae941:1785628800000",
    });
    expect(await prisma.capabilityRequest.findUniqueOrThrow({
      where: { requestId: "4cc2791f-fbc9-47af-b410-4bd0586ae941" },
    })).toMatchObject({ resultEventPublishedAt: expect.any(Date), callbackTokenHash: null });

    await expect(reconcileCapabilityCompletion({
      requestId: "4cc2791f-fbc9-47af-b410-4bd0586ae941",
      runId: "openclaw-run-1",
      callbackToken: submission.callback.token,
    }, prisma)).rejects.toThrow(/Invalid capability completion callback/);

    await expect(submitCapabilityRequest(jobEnvelope(grant.authorizationRef), prisma)).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    expect(await prisma.workbenchEvent.count({
      where: { kind: "CAPABILITY_RESULT_AVAILABLE" },
    })).toBe(1);
  });

  it("reconciles a completion callback that wins the submit-response race", async () => {
    const prisma = await database();
    mocks.discoverJobs.mockResolvedValue([{
      capability: "computer.gui.act",
      description: "Operate the desktop",
      lane: "JOB",
      risk: "R2",
      available: true,
      availability: "CONFIGURED",
      gateway: "openclaw",
      routeRevision: "operator-route-v1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    }]);
    const [grant] = await issueCapabilityGrants({
      taskId: "task-1",
      targets: [{
        capability: "computer.gui.act",
        risk: "R2",
        targetKind: "GATEWAY_CAPABILITY_ROUTE",
        targetFingerprint: "operator-route-v1",
      }],
    }, prisma);
    const callbackToken = "callback-token-that-is-long-enough-for-the-contract";
    const request = jobEnvelope(grant.authorizationRef);
    await prisma.capabilityRequest.create({
      data: {
        requestId: request.requestId,
        taskId: "task-1",
        capability: request.capability,
        lane: "JOB",
        risk: "R2",
        authorizationRef: grant.authorizationRef,
        inputDigest: "already-accepted",
        inputsJson: JSON.stringify(request.inputs),
        callbackTokenHash: createHash("sha256").update(callbackToken).digest("hex"),
      },
    });

    await expect(reconcileCapabilityCompletion({
      requestId: request.requestId,
      runId: "openclaw-run-1",
      callbackToken,
    }, prisma)).resolves.toMatchObject({
      status: "SUCCEEDED",
      jobRef: "openclaw-run-1",
    });
    expect(mocks.submitJob).toHaveBeenCalledTimes(1);
    expect(mocks.readJob).toHaveBeenCalledTimes(1);
    expect(await prisma.workbenchEvent.count({
      where: { kind: "CAPABILITY_RESULT_AVAILABLE" },
    })).toBe(1);
  });

  it("settles a completion event that arrives before OpenClaw persists the terminal task snapshot", async () => {
    const prisma = await database();
    const callbackToken = "callback-token-that-is-long-enough-for-the-contract";
    await prisma.capabilityRequest.create({
      data: {
        requestId: "460880aa-2935-45d7-bfd8-ce0bedf0a147",
        taskId: "task-1",
        capability: "computer.gui.act",
        lane: "JOB",
        risk: "R1",
        inputDigest: "already-accepted",
        inputsJson: JSON.stringify({ instruction: "Read the report" }),
        state: "RUNNING",
        gateway: "openclaw",
        jobRef: "openclaw-run-1",
        callbackTokenHash: createHash("sha256").update(callbackToken).digest("hex"),
      },
    });
    mocks.readJob
      .mockResolvedValueOnce({
        gateway: "openclaw",
        requestedRef: "openclaw-run-1",
        jobRef: "openclaw-task-1",
        runId: "openclaw-run-1",
        status: "RUNNING",
        revision: "1785628799900",
        updatedAt: "2026-08-01T23:59:59.900Z",
        summary: null,
      })
      .mockResolvedValueOnce({
        gateway: "openclaw",
        requestedRef: "openclaw-run-1",
        jobRef: "openclaw-task-1",
        runId: "openclaw-run-1",
        status: "SUCCEEDED",
        revision: "1785628800000",
        updatedAt: "2026-08-02T00:00:00.000Z",
        summary: "Report opened",
      });

    await expect(reconcileCapabilityCompletion({
      requestId: "460880aa-2935-45d7-bfd8-ce0bedf0a147",
      runId: "openclaw-run-1",
      callbackToken,
    }, prisma)).resolves.toMatchObject({
      status: "SUCCEEDED",
      revision: "1785628800000",
    });
    expect(mocks.readJob).toHaveBeenCalledTimes(2);
    expect(await prisma.workbenchEvent.count({
      where: { kind: "CAPABILITY_RESULT_AVAILABLE" },
    })).toBe(1);
  });

  it("recovers a terminal Job whose durable Workbench event was not marked as published", async () => {
    const firstProcess = await database();
    const databasePath = join(directories.at(-1)!, "capability.db");
    await firstProcess.capabilityRequest.create({
      data: {
        requestId: "460880aa-2935-45d7-bfd8-ce0bedf0a146",
        taskId: "task-1",
        capability: "computer.gui.act",
        lane: "JOB",
        risk: "R1",
        inputDigest: "digest",
        inputsJson: JSON.stringify({ instruction: "Open the report" }),
        state: "SIDE_EFFECT_UNKNOWN",
        gateway: "openclaw",
        jobRef: "openclaw-run-uncertain",
        revision: "revision-9",
        resultSummary: "Outcome could not be confirmed",
        evidenceJson: JSON.stringify(["openclaw-task:openclaw-run-uncertain"]),
        completedAt: new Date(),
      },
    });

    await firstProcess.$disconnect();
    const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
    clients.push(prisma);

    await expect(recoverPendingCapabilityRequests(25, prisma)).resolves.toEqual({
      scanned: 1,
      recovered: 1,
      blocked: 0,
    });
    expect(mocks.readJob).not.toHaveBeenCalled();
    const event = await prisma.workbenchEvent.findUniqueOrThrow({
      where: { dedupKey: "capability-result:460880aa-2935-45d7-bfd8-ce0bedf0a146:revision-9" },
    });
    expect(event).toMatchObject({
      priority: "HIGH",
      dedupKey: "capability-result:460880aa-2935-45d7-bfd8-ce0bedf0a146:revision-9",
    });
    expect(JSON.parse(event.payload)).toMatchObject({ status: "SIDE_EFFECT_UNKNOWN" });
    expect(await prisma.capabilityRequest.findUniqueOrThrow({
      where: { requestId: "460880aa-2935-45d7-bfd8-ce0bedf0a146" },
    })).toMatchObject({ resultEventPublishedAt: expect.any(Date) });
  });

  it("maps a lost external Job to SIDE_EFFECT_UNKNOWN and rejects a delayed active snapshot", async () => {
    const prisma = await database();
    const requestId = "460880aa-2935-45d7-bfd8-ce0bedf0a145";
    await prisma.capabilityRequest.create({
      data: {
        requestId,
        taskId: "task-1",
        capability: "computer.gui.act",
        lane: "JOB",
        risk: "R1",
        inputDigest: "digest",
        inputsJson: JSON.stringify({ instruction: "Open the report" }),
        state: "RUNNING",
        gateway: "openclaw",
        jobRef: "openclaw-run-lost",
        revision: "100",
      },
    });

    await expect(applyCapabilityJobSnapshot(requestId, {
      gateway: "openclaw",
      requestedRef: "openclaw-run-lost",
      jobRef: "openclaw-task-lost",
      runId: "openclaw-run-lost",
      status: "SIDE_EFFECT_UNKNOWN",
      revision: "200",
      updatedAt: "2026-08-03T04:00:00.200Z",
      summary: "The OpenClaw task record was lost; external effects cannot be proven absent",
    }, prisma)).resolves.toMatchObject({ status: "SIDE_EFFECT_UNKNOWN", revision: "200" });

    await expect(applyCapabilityJobSnapshot(requestId, {
      gateway: "openclaw",
      requestedRef: "openclaw-run-lost",
      jobRef: "openclaw-task-lost",
      runId: "openclaw-run-lost",
      status: "RUNNING",
      revision: "150",
      updatedAt: "2026-08-03T04:00:00.150Z",
      summary: null,
    }, prisma)).resolves.toMatchObject({ status: "SIDE_EFFECT_UNKNOWN", revision: "200" });

    expect(await prisma.workbenchEvent.count({
      where: { kind: "CAPABILITY_RESULT_AVAILABLE" },
    })).toBe(1);
  });

  it("never lets a late RUNNING observation overwrite a terminal Job revision", async () => {
    const prisma = await database();
    mocks.discoverJobs.mockResolvedValue([{
      capability: "computer.gui.act",
      description: "Operate the desktop",
      lane: "JOB",
      risk: "R2",
      available: true,
      availability: "CONFIGURED",
      gateway: "openclaw",
      routeRevision: "operator-route-v1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    }]);
    const [grant] = await issueCapabilityGrants({
      taskId: "task-1",
      targets: [{
        capability: "computer.gui.act",
        risk: "R2",
        targetKind: "GATEWAY_CAPABILITY_ROUTE",
        targetFingerprint: "operator-route-v1",
      }],
    }, prisma);
    const request = jobEnvelope(grant.authorizationRef);
    await submitCapabilityRequest(request, prisma);

    let releaseRunning!: () => void;
    const runningGate = new Promise<void>((resolve) => { releaseRunning = resolve; });
    mocks.readJob
      .mockImplementationOnce(async () => {
        await runningGate;
        return {
          gateway: "openclaw",
          requestedRef: "openclaw-run-1",
          jobRef: "openclaw-task-1",
          runId: "openclaw-run-1",
          status: "RUNNING",
          revision: "100",
          updatedAt: "2026-08-02T00:00:00.100Z",
          summary: null,
        };
      })
      .mockResolvedValueOnce({
        gateway: "openclaw",
        requestedRef: "openclaw-run-1",
        jobRef: "openclaw-task-1",
        runId: "openclaw-run-1",
        status: "SUCCEEDED",
        revision: "200",
        updatedAt: "2026-08-02T00:00:00.200Z",
        summary: "Finished",
      });

    const lateRunning = submitCapabilityRequest(request, prisma);
    await vi.waitFor(() => expect(mocks.readJob).toHaveBeenCalledTimes(1));
    await expect(submitCapabilityRequest(request, prisma)).resolves.toMatchObject({
      status: "SUCCEEDED",
      revision: "200",
    });
    releaseRunning();
    await expect(lateRunning).resolves.toMatchObject({ status: "SUCCEEDED", revision: "200" });

    expect(await prisma.capabilityRequest.findUniqueOrThrow({ where: { requestId: request.requestId } }))
      .toMatchObject({ state: "SUCCEEDED", revision: "200", jobRef: "openclaw-run-1" });
  });

  it("rejects Job inputs before consuming the bounded grant", async () => {
    const prisma = await database();
    mocks.discoverJobs.mockResolvedValue([{
      capability: "computer.gui.act",
      description: "Operate the desktop",
      lane: "JOB",
      risk: "R2",
      available: true,
      availability: "CONFIGURED",
      gateway: "openclaw",
      routeRevision: "operator-route-v1",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["instruction"],
        properties: { instruction: { type: "string", minLength: 1 } },
      },
      outputSchema: { type: "object" },
    }]);
    const [grant] = await issueCapabilityGrants({
      taskId: "task-1",
      targets: [{
        capability: "computer.gui.act",
        risk: "R2",
        targetKind: "GATEWAY_CAPABILITY_ROUTE",
        targetFingerprint: "operator-route-v1",
      }],
    }, prisma);

    await expect(submitCapabilityRequest(jobEnvelope(grant.authorizationRef, { inputs: {} }), prisma))
      .rejects.toThrow(/advertised schema/);
    const stored = await prisma.capabilityGrant.findUniqueOrThrow({ where: { id: grant.authorizationRef } });
    expect(stored.usedCount).toBe(0);
    expect(mocks.submitJob).not.toHaveBeenCalled();
  });
});
