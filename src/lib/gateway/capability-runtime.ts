import "server-only";

import Ajv from "ajv";
import { createHash, randomBytes } from "node:crypto";
import type { CapabilityRequest, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import { enqueueHarnessOutbound } from "@/lib/harness/harness-outbound";
import {
  CAPABILITY_SCHEMA_VERSION,
  OWNER_MESSAGE_CAPABILITY,
  capabilityEnvelopeDigest,
  capabilityRequestSchema,
  capabilityResultSchema,
  ownerMessageInputSchema,
  parseEvidence,
  type CapabilityRequestEnvelope,
  type CapabilityRequestSnapshot,
} from "./capability-contract";
import {
  readActiveCapabilityGrant,
  readActiveOwnerMessageGrant,
  type CapabilityGrantTarget,
} from "./capability-grants";
import {
  discoverOpenClawCapabilities,
  submitOpenClawCapabilityJob,
  type OpenClawCapabilityDescriptor,
} from "./openclaw-capability-client";
import { readOpenClawCapabilityJob } from "./openclaw-task-client";
import { readOwnerHomeTarget } from "./capability-target";
import { secureInternalEqual } from "@/lib/internal-api-signing";
import { publishWorkbenchCommand } from "@/lib/workbench/command-inbox";
import {
  assertUnattendedGoalOperationAllowed,
  recordUnattendedGoalProgressFact,
  type GoalPolicyDb,
} from "@/lib/unattended-goal/policy";
import { readUnattendedGoalAuthorizationState } from "@/lib/unattended-goal/runtime";

type CapabilityDb = Pick<
  PrismaClient,
  "task" | "capabilityGrant" | "capabilityRequest" | "$transaction"
> & GoalPolicyDb;

type Risk = "R0" | "R1" | "R2" | "R3";

interface RuntimeCapabilityDescriptor {
  capability: string;
  description: string;
  lane: "DIRECT" | "JOB";
  risk: Risk;
  available: boolean;
  availability: "CONFIGURED" | "UNAVAILABLE";
  unavailableReason: string | null;
  gateway: "hermes" | "openclaw" | null;
  targetKind: "OWNER_HOME_ROUTE" | "GATEWAY_CAPABILITY_ROUTE";
  routeRevision: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

const TERMINAL_STATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "EXPIRED",
  "SIDE_EFFECT_UNKNOWN",
]);
const ACTIVE_REQUEST_STATES = ["PENDING", "ACCEPTED", "RUNNING"] as const;

function capabilityCallbackUrl(env: Record<string, string>): string {
  const base = env.TOWER_API_URL
    || process.env.TOWER_API_URL
    || `http://127.0.0.1:${process.env.PORT || "3000"}`;
  const url = new URL("/api/internal/harness/capabilities/completions", base);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Capability completion callback must use the local Tower HTTP endpoint");
  }
  return url.toString();
}

function hashCallbackToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requestSnapshot(row: CapabilityRequest): CapabilityRequestSnapshot {
  return {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    requestId: row.requestId,
    capability: row.capability,
    lane: row.lane,
    risk: row.risk,
    status: row.state,
    revision: row.revision || row.updatedAt.toISOString(),
    summary: row.resultSummary,
    evidence: parseEvidence(row.evidenceJson),
    gateway: row.gateway,
    jobRef: row.jobRef,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function blockRequest(requestId: string, reason: string, database: CapabilityDb) {
  await database.capabilityRequest.updateMany({
    where: { requestId, state: { in: [...ACTIVE_REQUEST_STATES] } },
    data: {
      state: "BLOCKED",
      resultSummary: "The capability request requires configuration or renewed OWNER authorization",
      lastError: reason.slice(0, 2_000),
      completedAt: new Date(),
      callbackTokenHash: null,
    },
  });
  const row = await database.capabilityRequest.findUniqueOrThrow({ where: { requestId } });
  return requestSnapshot(await publishCapabilityResultIfNeeded(row, database));
}

async function publishCapabilityResultIfNeeded(
  request: CapabilityRequest,
  database: CapabilityDb,
): Promise<CapabilityRequest> {
  if (
    request.lane !== "JOB"
    || !TERMINAL_STATES.has(request.state)
    || request.resultEventPublishedAt
  ) return request;

  const task = await database.task.findUnique({
    where: { id: request.taskId },
    select: { id: true, title: true },
  });
  if (!task) return request;
  const revision = request.revision || request.updatedAt.toISOString();
  await publishWorkbenchCommand({
    parentTaskId: task.id,
    sourceTaskId: task.id,
    kind: "CAPABILITY_RESULT_AVAILABLE",
    priority: request.state === "SUCCEEDED" ? "NORMAL" : "HIGH",
    dedupKey: `capability-result:${request.requestId}:${revision}`,
    payload: {
      childTaskId: task.id,
      childTitle: task.title,
      requestId: request.requestId,
      capability: request.capability,
      status: request.state,
      revision,
      summary: request.resultSummary ?? undefined,
      evidence: parseEvidence(request.evidenceJson),
      jobRef: request.jobRef ?? undefined,
    },
  });
  await recordUnattendedGoalProgressFact({
    taskId: task.id,
    kind: request.state === "SUCCEEDED" ? "CAPABILITY_JOB_SUCCEEDED" : "CAPABILITY_JOB_FAILED",
    dedupKey: `capability-result:${request.requestId}:${revision}`,
  }, database);
  await database.capabilityRequest.updateMany({
    where: { requestId: request.requestId, resultEventPublishedAt: null },
    data: {
      resultEventPublishedAt: new Date(),
      callbackTokenHash: null,
    },
  });
  return database.capabilityRequest.findUniqueOrThrow({ where: { requestId: request.requestId } });
}

function parseInputs(row: CapabilityRequest): Record<string, unknown> {
  const parsed = JSON.parse(row.inputsJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Capability request has invalid persisted inputs");
  }
  return parsed as Record<string, unknown>;
}

function ownerDescriptor(target: Awaited<ReturnType<typeof readOwnerHomeTarget>>): RuntimeCapabilityDescriptor {
  return {
    capability: OWNER_MESSAGE_CAPABILITY,
    description: "Send one message to the fixed unattended OWNER home route",
    lane: "DIRECT",
    risk: "R2",
    available: Boolean(target),
    availability: target ? "CONFIGURED" : "UNAVAILABLE",
    unavailableReason: target ? null : "No fixed unattended OWNER home route is configured",
    gateway: target?.gateway ?? null,
    targetKind: "OWNER_HOME_ROUTE",
    routeRevision: target?.fingerprint ?? null,
    inputSchema: ownerMessageInputSchema,
    outputSchema: capabilityResultSchema,
  };
}

function jobDescriptor(value: OpenClawCapabilityDescriptor): RuntimeCapabilityDescriptor {
  return {
    ...value,
    unavailableReason: value.available ? null : "OpenClaw capability is unavailable",
    targetKind: "GATEWAY_CAPABILITY_ROUTE",
  };
}

async function readRuntimeCapabilities(): Promise<RuntimeCapabilityDescriptor[]> {
  const target = await readOwnerHomeTarget();
  let jobs: RuntimeCapabilityDescriptor[] = [];
  try {
    const config = await readHarnessGatewayRuntimeConfig("openclaw");
    jobs = (await discoverOpenClawCapabilities(config.env)).map(jobDescriptor);
  } catch {
    // The optional OpenClaw plugin may be absent or the Gateway may be down.
    // DIRECT discovery remains useful and no fallback route is invented.
  }
  return [ownerDescriptor(target), ...jobs];
}

function grantTarget(descriptor: RuntimeCapabilityDescriptor): CapabilityGrantTarget | null {
  if (!descriptor.routeRevision) return null;
  return {
    capability: descriptor.capability,
    risk: descriptor.risk,
    targetKind: descriptor.targetKind,
    targetFingerprint: descriptor.routeRevision,
  };
}

export async function discoverGatewayCapabilities(
  taskId?: string,
  database: CapabilityDb = db,
) {
  const capabilities = await readRuntimeCapabilities();
  const goalState = taskId
    ? await readUnattendedGoalAuthorizationState(database, taskId)
    : null;
  return {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    discoveryMode: "thin-adapter" as const,
    registryAuthority: "gateway" as const,
    capabilities: await Promise.all(capabilities.map(async (capability) => {
      const target = grantTarget(capability);
      const grantContextActive = goalState === "ACTIVE"
        || (goalState === "BLOCKED" && capability.capability === OWNER_MESSAGE_CAPABILITY);
      const grant = taskId && target && grantContextActive
        && (capability.risk === "R2" || capability.risk === "R3")
        ? capability.capability === OWNER_MESSAGE_CAPABILITY
          ? await readActiveOwnerMessageGrant(taskId, database)
          : await readActiveCapabilityGrant(taskId, target, database)
        : null;
      return {
        ...capability,
        authorization: {
          required: capability.risk === "R2" || capability.risk === "R3",
          authorizationRef: grant?.authorizationRef ?? null,
          expiresAt: grant?.expiresAt ?? null,
          remainingUses: grant?.remainingUses ?? 0,
        },
      };
    })),
  };
}

function validateInputs(inputs: Record<string, unknown>, schema: Record<string, unknown>): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(inputs)) {
    const detail = validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`Capability inputs do not match the advertised schema: ${detail || "invalid inputs"}`);
  }
}

async function createCapabilityRequest(
  envelope: CapabilityRequestEnvelope,
  digest: string,
  database: CapabilityDb,
): Promise<CapabilityRequest> {
  const descriptors = await readRuntimeCapabilities();
  const descriptor = descriptors.find((candidate) =>
    candidate.capability === envelope.capability
    && candidate.lane === envelope.lane
    && candidate.risk === envelope.risk
  );
  if (!descriptor?.available || !descriptor.routeRevision) {
    throw new Error("Capability is not currently advertised by the Gateway");
  }
  validateInputs(envelope.inputs, descriptor.inputSchema);
  if (envelope.lane === "JOB") {
    await assertUnattendedGoalOperationAllowed(
      envelope.towerContext.taskId,
      "CAPABILITY_JOB",
      database,
    );
  }
  const requiresGrant = envelope.risk === "R2" || envelope.risk === "R3";
  return database.$transaction(async (tx) => {
    const existing = await tx.capabilityRequest.findUnique({ where: { requestId: envelope.requestId } });
    if (existing) {
      if (existing.inputDigest !== digest || existing.taskId !== envelope.towerContext.taskId) {
        throw new Error("requestId is already bound to a different capability request");
      }
      return existing;
    }
    const task = await tx.task.findUnique({ where: { id: envelope.towerContext.taskId }, select: { id: true } });
    if (!task) throw new Error("task not found");
    if (requiresGrant) {
      const goalState = await readUnattendedGoalAuthorizationState(tx, envelope.towerContext.taskId);
      const grantContextActive = goalState === "ACTIVE"
        || (goalState === "BLOCKED" && descriptor.capability === OWNER_MESSAGE_CAPABILITY);
      if (!grantContextActive) {
        throw new Error("Bounded OWNER authorization is valid only for an active unattended Goal");
      }
      const grant = envelope.authorizationRef
        ? await tx.capabilityGrant.findUnique({ where: { id: envelope.authorizationRef } })
        : null;
      if (
        !grant
        || grant.taskId !== envelope.towerContext.taskId
        || grant.capability !== descriptor.capability
        || grant.risk !== descriptor.risk
        || grant.targetKind !== descriptor.targetKind
        || grant.targetFingerprint !== descriptor.routeRevision
        || grant.issuer !== "TOWER_UI"
        || grant.revokedAt
        || grant.expiresAt <= new Date()
        || grant.usedCount >= grant.maxUses
      ) throw new Error(`${envelope.risk} capability requires a valid bounded OWNER authorization grant`);
      const consumed = await tx.capabilityGrant.updateMany({
        where: {
          id: grant.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          usedCount: { lt: grant.maxUses },
        },
        data: { usedCount: { increment: 1 } },
      });
      if (consumed.count !== 1) throw new Error("Authorization grant was exhausted or expired");
    }
    return tx.capabilityRequest.create({
      data: {
        requestId: envelope.requestId,
        taskId: envelope.towerContext.taskId,
        schemaVersion: envelope.schemaVersion,
        capability: envelope.capability,
        lane: envelope.lane,
        risk: envelope.risk,
        authorizationRef: envelope.authorizationRef,
        inputDigest: digest,
        inputsJson: JSON.stringify(envelope.inputs),
      },
    });
  });
}

async function dispatchDirect(
  request: CapabilityRequest,
  database: CapabilityDb,
): Promise<CapabilityRequestSnapshot> {
  const [target, grant, task] = await Promise.all([
    readOwnerHomeTarget(),
    request.authorizationRef
      ? database.capabilityGrant.findUnique({ where: { id: request.authorizationRef } })
      : null,
    database.task.findUnique({ where: { id: request.taskId }, select: { id: true, title: true } }),
  ]);
  if (!task) return blockRequest(request.requestId, "Task no longer exists", database);
  if (!target || !grant || grant.taskId !== request.taskId || grant.targetFingerprint !== target.fingerprint) {
    return blockRequest(request.requestId, "Accepted request no longer matches the configured OWNER route", database);
  }

  // Authorization is consumed atomically when the request is accepted. Expiry
  // or later revocation prevents new requests; it must not invalidate an
  // already accepted intent during crash recovery. A route change still blocks
  // dispatch because this request has not persisted a concrete destination.
  const inputs = parseInputs(request);
  const message = typeof inputs.message === "string" ? inputs.message.trim() : "";
  if (!message) return blockRequest(request.requestId, "Persisted message is invalid", database);
  const token = `[[tower:task=${request.taskId}]]`;
  const body = [task.title.trim(), message, `Task ID: ${token}`].filter(Boolean).join("\n\n");
  const outbound = await enqueueHarnessOutbound({
    taskId: request.taskId,
    gateway: target.gateway,
    downstream: target.downstream,
    dest: target.dest,
    requestedTo: null,
    scope: "unattended",
    expectReply: inputs.expectReply === true,
    message: body,
    dedupKey: `capability:${request.requestId}`,
  });
  const state = outbound.state === "DELIVERED"
    ? "SUCCEEDED"
    : outbound.state === "SENT_UNVERIFIED"
      ? "SIDE_EFFECT_UNKNOWN"
      : "PENDING";
  const terminal = state === "SUCCEEDED" || state === "SIDE_EFFECT_UNKNOWN";
  const summary = state === "SUCCEEDED"
    ? "Message delivered to the OWNER home route"
    : state === "SIDE_EFFECT_UNKNOWN"
      ? "The platform may have accepted the message; automatic retry is disabled"
      : "Message delivery is queued for retry";
  const evidence = outbound.platformMessageId ? [`gateway-message:${outbound.platformMessageId}`] : [];
  await database.capabilityRequest.updateMany({
    where: { requestId: request.requestId, state: { in: [...ACTIVE_REQUEST_STATES] } },
    data: {
      state,
      gateway: target.gateway,
      outboundId: outbound.outboundId,
      revision: new Date().toISOString(),
      resultSummary: summary,
      evidenceJson: JSON.stringify(evidence),
      lastError: outbound.lastError,
      completedAt: terminal ? new Date() : null,
    },
  });
  const updated = await database.capabilityRequest.findUniqueOrThrow({ where: { requestId: request.requestId } });
  return requestSnapshot(await publishCapabilityResultIfNeeded(updated, database));
}

async function reconcileJob(
  request: CapabilityRequest,
  database: CapabilityDb,
): Promise<CapabilityRequestSnapshot> {
  const config = await readHarnessGatewayRuntimeConfig("openclaw");
  const gatewayEnv = config.env ?? {};
  const snapshot = await readOpenClawCapabilityJob(request.jobRef!, gatewayEnv);
  const terminal = TERMINAL_STATES.has(snapshot.status);
  await database.capabilityRequest.updateMany({
    where: { requestId: request.requestId, state: { in: [...ACTIVE_REQUEST_STATES] } },
    data: {
      state: snapshot.status,
      gateway: "openclaw",
      revision: snapshot.revision,
      resultSummary: snapshot.summary,
      evidenceJson: JSON.stringify([`openclaw-task:${snapshot.jobRef}`]),
      lastError: snapshot.status === "FAILED" ? snapshot.summary : null,
      completedAt: terminal ? new Date(snapshot.updatedAt) : null,
      callbackTokenHash: terminal ? null : request.callbackTokenHash,
    },
  });
  const updated = await database.capabilityRequest.findUniqueOrThrow({ where: { requestId: request.requestId } });
  return requestSnapshot(await publishCapabilityResultIfNeeded(updated, database));
}

async function dispatchJob(
  request: CapabilityRequest,
  database: CapabilityDb,
): Promise<CapabilityRequestSnapshot> {
  if (request.jobRef) return reconcileJob(request, database);
  const descriptors = await readRuntimeCapabilities();
  const descriptor = descriptors.find((candidate) =>
    candidate.capability === request.capability
    && candidate.lane === "JOB"
    && candidate.risk === request.risk
  );
  if (!descriptor?.available || !descriptor.routeRevision || descriptor.gateway !== "openclaw") {
    return blockRequest(request.requestId, "Accepted Job capability is no longer advertised", database);
  }
  if (request.risk === "R2" || request.risk === "R3") {
    const grant = request.authorizationRef
      ? await database.capabilityGrant.findUnique({ where: { id: request.authorizationRef } })
      : null;
    if (!grant || grant.taskId !== request.taskId || grant.targetFingerprint !== descriptor.routeRevision) {
      return blockRequest(request.requestId, "Accepted Job no longer matches the configured capability route", database);
    }
  }
  const task = await database.task.findUnique({
    where: { id: request.taskId },
    select: { id: true, projectId: true },
  });
  if (!task) return blockRequest(request.requestId, "Task no longer exists", database);
  const config = await readHarnessGatewayRuntimeConfig("openclaw");
  const gatewayEnv = config.env ?? {};
  const callbackToken = randomBytes(32).toString("base64url");
  await database.capabilityRequest.update({
    where: { requestId: request.requestId },
    data: { callbackTokenHash: hashCallbackToken(callbackToken) },
    select: { requestId: true },
  });
  const accepted = await submitOpenClawCapabilityJob({
    requestId: request.requestId,
    capability: request.capability,
    inputs: parseInputs(request),
    towerContext: { taskId: request.taskId, projectId: task.projectId },
    callback: {
      url: capabilityCallbackUrl(gatewayEnv),
      token: callbackToken,
    },
  }, gatewayEnv);
  await database.capabilityRequest.updateMany({
    where: { requestId: request.requestId, state: "PENDING", jobRef: null },
    data: {
      state: "ACCEPTED",
      gateway: "openclaw",
      jobRef: accepted.jobRef,
      revision: accepted.revision,
      resultSummary: "OpenClaw accepted the external capability Job",
      evidenceJson: JSON.stringify([`openclaw-task:${accepted.jobRef}`]),
      lastError: null,
    },
  });
  const updated = await database.capabilityRequest.findUniqueOrThrow({ where: { requestId: request.requestId } });
  return requestSnapshot(updated);
}

export async function reconcileCapabilityCompletion(
  input: { requestId: string; runId: string; callbackToken: string },
  database: CapabilityDb = db,
): Promise<CapabilityRequestSnapshot> {
  const request = await database.capabilityRequest.findUnique({ where: { requestId: input.requestId } });
  const actualHash = hashCallbackToken(input.callbackToken);
  if (
    !request
    || request.lane !== "JOB"
    || !request.callbackTokenHash
    || !secureInternalEqual(actualHash, request.callbackTokenHash)
  ) throw new Error("Invalid capability completion callback");
  if (request.jobRef && request.jobRef !== input.runId && !TERMINAL_STATES.has(request.state)) {
    throw new Error("Capability completion callback does not match the accepted Job");
  }
  let result = await dispatchCapabilityRequest(request.requestId, database);
  // A very fast Operator can finish before Tower persists the submit response.
  // The first dispatch is idempotent and repairs jobRef; reconcile immediately
  // so the completion hook remains the primary path instead of waiting for the
  // low-frequency recovery scan.
  if (!TERMINAL_STATES.has(result.status) && result.jobRef) {
    if (result.jobRef !== input.runId) {
      throw new Error("Capability completion callback does not match the accepted Job");
    }
    result = await dispatchCapabilityRequest(request.requestId, database);
  }
  if (TERMINAL_STATES.has(result.status)) {
    await database.capabilityRequest.updateMany({
      where: {
        requestId: request.requestId,
        state: { in: ["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "EXPIRED", "SIDE_EFFECT_UNKNOWN"] },
      },
      data: { callbackTokenHash: null },
    });
  }
  return result;
}

export async function dispatchCapabilityRequest(
  requestId: string,
  database: CapabilityDb = db,
): Promise<CapabilityRequestSnapshot> {
  const request = await database.capabilityRequest.findUnique({ where: { requestId } });
  if (!request) throw new Error("Capability request not found");
  if (TERMINAL_STATES.has(request.state)) {
    return requestSnapshot(await publishCapabilityResultIfNeeded(request, database));
  }
  if (request.schemaVersion !== CAPABILITY_SCHEMA_VERSION) {
    return blockRequest(requestId, "Unsupported capability schema version", database);
  }
  if (request.lane === "DIRECT") {
    if (request.capability !== OWNER_MESSAGE_CAPABILITY || request.risk !== "R2" || !request.authorizationRef) {
      return blockRequest(requestId, "Unsupported or incomplete DIRECT capability request", database);
    }
    return dispatchDirect(request, database);
  }
  return dispatchJob(request, database);
}

export async function submitCapabilityRequest(
  rawEnvelope: unknown,
  database: CapabilityDb = db,
): Promise<CapabilityRequestSnapshot> {
  const envelope = capabilityRequestSchema.parse(rawEnvelope);
  const digest = capabilityEnvelopeDigest(envelope);
  const existing = await database.capabilityRequest.findUnique({ where: { requestId: envelope.requestId } });
  if (existing) {
    if (existing.inputDigest !== digest || existing.taskId !== envelope.towerContext.taskId) {
      throw new Error("requestId is already bound to a different capability request");
    }
  } else {
    await createCapabilityRequest(envelope, digest, database);
  }
  return dispatchCapabilityRequest(envelope.requestId, database);
}

export async function readCapabilityRequest(
  requestId: string,
  taskId: string,
  database: CapabilityDb = db,
): Promise<CapabilityRequestSnapshot> {
  const row = await database.capabilityRequest.findUnique({ where: { requestId } });
  if (!row || row.taskId !== taskId) throw new Error("Capability request not found");
  return requestSnapshot(row);
}

export async function recoverPendingCapabilityRequests(
  limit = 25,
  database: CapabilityDb = db,
): Promise<{ scanned: number; recovered: number; blocked: number }> {
  const pending = await database.capabilityRequest.findMany({
    where: {
      OR: [
        { state: { in: ["PENDING", "ACCEPTED", "RUNNING"] } },
        {
          lane: "JOB",
          state: { in: ["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "EXPIRED", "SIDE_EFFECT_UNKNOWN"] },
          resultEventPublishedAt: null,
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { requestId: true },
  });
  let recovered = 0;
  let blocked = 0;
  for (const item of pending) {
    try {
      const result = await dispatchCapabilityRequest(item.requestId, database);
      if (TERMINAL_STATES.has(result.status) && result.status !== "BLOCKED") recovered++;
      if (result.status === "BLOCKED") blocked++;
    } catch {
      // Submission/reconciliation is retried with the same requestId. The
      // Gateway owns Job idempotency and Tower never guesses a terminal result.
    }
  }
  return { scanned: pending.length, recovered, blocked };
}
