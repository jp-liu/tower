import "server-only";

import { randomUUID } from "node:crypto";
import type { CapabilityRequestState, Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  OWNER_MESSAGE_CAPABILITY,
  type CapabilityRequestSnapshot,
} from "@/lib/gateway/capability-contract";
import { readActiveOwnerMessageGrant } from "@/lib/gateway/capability-grants";
import {
  dispatchCapabilityRequest,
  readCapabilityRequest,
  submitCapabilityRequest,
} from "@/lib/gateway/capability-runtime";
import { setUnattendedSignal } from "@/lib/harness/unattended-signal";

export type GoalTerminalNotificationKind = "COMPLETED" | "BLOCKED";

type FinalNotificationDb = PrismaClient;

const ACTIVE_REQUEST_STATES = new Set<CapabilityRequestState>(["PENDING", "ACCEPTED", "RUNNING"]);
const RETRYABLE_TERMINAL_STATES = new Set<CapabilityRequestState>([
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "EXPIRED",
]);

export interface GoalFinalNotificationResult {
  taskId: string;
  kind: GoalTerminalNotificationKind;
  requestId: string;
  state: string;
  runtimeState: "ACTIVE" | "BLOCKED" | "ENDED";
  error: string | null;
}

function bounded(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function resultMessage(input: {
  taskTitle: string;
  taskStatus: string;
  executionSummary: string | null;
  kind: GoalTerminalNotificationKind;
  reason?: string | null;
}): string {
  if (input.kind === "BLOCKED") {
    return bounded([
      `Unattended Goal \"${input.taskTitle}\" is blocked and needs OWNER attention.`,
      input.reason ? `Reason: ${input.reason}` : null,
    ].filter(Boolean).join("\n\n"), 4_000);
  }
  const status = input.taskStatus === "DONE"
    ? "completed"
    : input.taskStatus === "CANCELLED"
      ? "was cancelled"
      : "finished and is ready for review";
  return bounded([
    `Unattended Goal \"${input.taskTitle}\" ${status}.`,
    input.executionSummary ? `Result: ${input.executionSummary}` : null,
  ].filter(Boolean).join("\n\n"), 4_000);
}

async function findExistingTerminalRequest(
  taskId: string,
  activatedAt: Date,
  database: FinalNotificationDb,
) {
  const where: Prisma.CapabilityRequestWhereInput = {
    taskId,
    capability: OWNER_MESSAGE_CAPABILITY,
    goalTerminalKind: { in: ["COMPLETED", "BLOCKED"] },
    createdAt: { gte: activatedAt },
  };
  return (await database.capabilityRequest.findFirst({
    where: { ...where, state: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
  })) ?? database.capabilityRequest.findFirst({
    where,
    orderBy: { createdAt: "desc" },
  });
}

async function prepareNotificationIntent(
  input: {
    taskId: string;
    kind: GoalTerminalNotificationKind;
    lifecycleEvent: string;
    reason?: string | null;
  },
  database: FinalNotificationDb,
) {
  return database.$transaction(async (tx) => {
    const runtime = await tx.unattendedGoalRuntime.findUnique({ where: { taskId: input.taskId } });
    if (!runtime) return null;
    const task = await tx.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        title: true,
        status: true,
        executions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { summary: true },
        },
      },
    });
    if (!task) return null;

    const existingRequest = await findExistingTerminalRequest(input.taskId, runtime.activatedAt, tx as never);
    const requestKind = (existingRequest?.goalTerminalKind
      ?? runtime.ownerNotificationKind
      ?? input.kind) as GoalTerminalNotificationKind;
    const summary = runtime.ownerNotificationSummary ?? resultMessage({
      taskTitle: task.title,
      taskStatus: task.status,
      executionSummary: task.executions[0]?.summary ?? null,
      kind: requestKind,
      reason: input.reason ?? runtime.blockedReason,
    });
    const requestId = existingRequest?.requestId ?? runtime.ownerNotificationRequestId ?? randomUUID();
    const binding = runtime.ownerNotificationBinding ?? `[[tower:task=${task.id}]]`;
    const requestState = existingRequest?.state ?? runtime.ownerNotificationState ?? "INTENT";
    const createdAt = runtime.ownerNotificationCreatedAt ?? new Date();

    await tx.task.update({
      where: { id: task.id },
      data: { unattended: false },
      select: { id: true },
    });
    const updated = await tx.unattendedGoalRuntime.update({
      where: { taskId: task.id },
      data: {
        state: "BLOCKED",
        lastEventKind: input.lifecycleEvent,
        endedAt: null,
        blockedAt: runtime.blockedAt ?? new Date(),
        blockedReason: requestKind === "BLOCKED"
          ? (input.reason ?? runtime.blockedReason ?? "The unattended Goal needs OWNER attention")
          : "Final OWNER notification has not been confirmed",
        nextWakeAt: null,
        wakeReason: null,
        ownerNotificationRequestId: requestId,
        ownerNotificationKind: requestKind,
        ownerNotificationState: requestState,
        ownerNotificationSummary: summary,
        ownerNotificationBinding: binding,
        ownerNotificationError: existingRequest?.lastError ?? runtime.ownerNotificationError,
        ownerNotificationCreatedAt: createdAt,
        ownerNotificationCompletedAt: existingRequest?.completedAt ?? runtime.ownerNotificationCompletedAt,
      },
    });
    return { runtime: updated, existingRequest };
  });
}

async function settleNotification(
  taskId: string,
  snapshot: CapabilityRequestSnapshot | null,
  error: string | null,
  database: FinalNotificationDb,
): Promise<GoalFinalNotificationResult> {
  const now = new Date();
  const result = await database.$transaction(async (tx) => {
    const runtime = await tx.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId } });
    const kind = runtime.ownerNotificationKind as GoalTerminalNotificationKind;
    const status = snapshot?.status ?? "BLOCKED";
    const delivered = status === "SUCCEEDED";
    const completed = delivered || status === "SIDE_EFFECT_UNKNOWN" || RETRYABLE_TERMINAL_STATES.has(status);
    const runtimeState = kind === "COMPLETED" && delivered ? "ENDED" : "BLOCKED";
    const diagnostic = error
      ?? (status === "SIDE_EFFECT_UNKNOWN"
        ? "The OWNER message may have been accepted; automatic retry is disabled pending manual reconciliation"
        : delivered
          ? null
          : snapshot?.summary ?? "Final OWNER notification could not be confirmed");

    await tx.capabilityGrant.updateMany({
      where: { taskId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.task.update({
      where: { id: taskId },
      data: { unattended: false },
      select: { id: true },
    });
    const updated = await tx.unattendedGoalRuntime.update({
      where: { taskId },
      data: {
        state: runtimeState,
        endedAt: runtimeState === "ENDED" ? (runtime.endedAt ?? now) : null,
        blockedAt: runtimeState === "BLOCKED" ? (runtime.blockedAt ?? now) : runtime.blockedAt,
        blockedReason: runtimeState === "ENDED"
          ? null
          : kind === "BLOCKED"
            ? runtime.blockedReason
            : diagnostic,
        ownerNotificationState: status,
        ownerNotificationError: diagnostic,
        ownerNotificationCompletedAt: completed ? (runtime.ownerNotificationCompletedAt ?? now) : null,
      },
    });
    return {
      taskId,
      kind,
      requestId: runtime.ownerNotificationRequestId!,
      state: status,
      runtimeState: updated.state,
      error: diagnostic,
    };
  });
  setUnattendedSignal(taskId, false);
  return result;
}

async function attemptNotification(
  taskId: string,
  database: FinalNotificationDb,
): Promise<GoalFinalNotificationResult> {
  const runtime = await database.unattendedGoalRuntime.findUniqueOrThrow({ where: { taskId } });
  const requestId = runtime.ownerNotificationRequestId!;
  let request = await database.capabilityRequest.findUnique({ where: { requestId } });
  let snapshot: CapabilityRequestSnapshot | null = null;
  try {
    if (request) {
      snapshot = ACTIVE_REQUEST_STATES.has(request.state)
        ? await dispatchCapabilityRequest(requestId, database as never)
        : await readCapabilityRequest(requestId, taskId, database as never);
    } else {
      const grant = await readActiveOwnerMessageGrant(taskId, database as never);
      if (!grant) {
        return settleNotification(
          taskId,
          null,
          "OWNER authorization is unavailable, expired, or exhausted before the final notification request was accepted",
          database,
        );
      }
      snapshot = await submitCapabilityRequest({
        schemaVersion: 1,
        requestId,
        capability: OWNER_MESSAGE_CAPABILITY,
        lane: "DIRECT",
        risk: "R2",
        authorizationRef: grant.authorizationRef,
        inputs: {
          message: runtime.ownerNotificationSummary!,
          expectReply: true,
          goalTerminal: runtime.ownerNotificationKind as GoalTerminalNotificationKind,
        },
        expectedOutput: { summary: true, evidence: [] },
        towerContext: { taskId },
        constraints: ["fixed-owner-home-route", "no-automatic-retry-on-side-effect-unknown"],
      }, database as never);
      request = await database.capabilityRequest.findUnique({ where: { requestId } });
    }
    return settleNotification(taskId, snapshot, request?.lastError ?? null, database);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return settleNotification(taskId, null, bounded(message, 2_000), database);
  }
}

export async function ensureUnattendedGoalFinalNotification(
  input: {
    taskId: string;
    kind: GoalTerminalNotificationKind;
    lifecycleEvent: string;
    reason?: string | null;
  },
  database: FinalNotificationDb = db,
): Promise<GoalFinalNotificationResult | null> {
  const prepared = await prepareNotificationIntent(input, database);
  if (!prepared) return null;
  return attemptNotification(input.taskId, database);
}

export async function recoverUnattendedGoalFinalNotification(
  taskId: string,
  database: FinalNotificationDb = db,
  explicitRetry = false,
): Promise<GoalFinalNotificationResult | null> {
  let runtime = await database.unattendedGoalRuntime.findUnique({ where: { taskId } });
  if (!runtime?.ownerNotificationRequestId || !runtime.ownerNotificationKind) return null;
  const successful = await database.capabilityRequest.findFirst({
    where: {
      taskId,
      capability: OWNER_MESSAGE_CAPABILITY,
      goalTerminalKind: runtime.ownerNotificationKind,
      state: "SUCCEEDED",
      createdAt: { gte: runtime.activatedAt },
    },
    orderBy: { createdAt: "desc" },
  });
  if (successful && successful.requestId !== runtime.ownerNotificationRequestId) {
    runtime = await database.unattendedGoalRuntime.update({
      where: { taskId },
      data: { ownerNotificationRequestId: successful.requestId },
    });
  }
  const request = await database.capabilityRequest.findUnique({
    where: { requestId: runtime.ownerNotificationRequestId! },
  });
  if (request?.state === "SIDE_EFFECT_UNKNOWN") {
    return settleNotification(
      taskId,
      await readCapabilityRequest(request.requestId, taskId, database as never),
      request.lastError,
      database,
    );
  }
  if (request && RETRYABLE_TERMINAL_STATES.has(request.state)) {
    if (!explicitRetry) return settleNotification(
      taskId,
      await readCapabilityRequest(request.requestId, taskId, database as never),
      request.lastError,
      database,
    );
    runtime = await database.unattendedGoalRuntime.update({
      where: { taskId },
      data: {
        ownerNotificationRequestId: randomUUID(),
        ownerNotificationState: "INTENT",
        ownerNotificationError: null,
        ownerNotificationCompletedAt: null,
      },
    });
  }
  return attemptNotification(taskId, database);
}

export async function reconcileUnattendedGoalFinalNotifications(
  database: FinalNotificationDb = db,
): Promise<{ scanned: number; recovered: number }> {
  const pending = await database.unattendedGoalRuntime.findMany({
    where: {
      ownerNotificationRequestId: { not: null },
      ownerNotificationKind: { not: null },
      ownerNotificationState: { in: ["INTENT", "PENDING", "ACCEPTED", "RUNNING"] },
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: { taskId: true },
  });
  let recovered = 0;
  for (const item of pending) {
    const result = await recoverUnattendedGoalFinalNotification(item.taskId, database).catch(() => null);
    if (result?.state === "SUCCEEDED") recovered++;
  }
  return { scanned: pending.length, recovered };
}
