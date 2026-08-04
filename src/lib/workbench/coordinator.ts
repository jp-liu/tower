import "server-only";

import type { Prisma, WorkbenchRuntimeState } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { buildChildReviewPrompt } from "@/lib/derive/child-review-prompt";
import { logger } from "@/lib/logger";
import { getSession, markSessionTurnComplete } from "@/lib/pty/session-store";
import { planTerminalWrite } from "@/lib/pty/terminal-submit";
import { notifyWorkbenchBatchDispatched } from "./delivery-lifecycle";
import {
  hasWorkbenchDrainBoundary,
  markWorkbenchDrainBoundary,
  scheduleAtWorkbenchDrainBoundary,
  takeWorkbenchDrainBoundary,
} from "./boundary";
import type {
  EnqueueWorkbenchEventInput,
  WorkbenchEventKind,
  WorkbenchEventPayload,
  WorkbenchEventPriority,
} from "./event-contract";

export type {
  EnqueueWorkbenchEventInput,
  WorkbenchEventKind,
  WorkbenchEventPayload,
  WorkbenchEventPriority,
} from "./event-contract";

const log = logger.create("workbench-coordinator");

export const WORKBENCH_NORMAL_COALESCE_MS = 750;
export const WORKBENCH_HIGH_COALESCE_MS = 100;
export const WORKBENCH_CLAIM_LEASE_MS = 60_000;
export const WORKBENCH_ACK_LEASE_MS = 120_000;
export const WORKBENCH_PROCESSING_LEASE_MS = 5 * 60_000;
export const WORKBENCH_MAX_BATCH_SIZE = 50;
export const WORKBENCH_RECOVERY_BATCH_SIZE = 500;
export const WORKBENCH_EVENTS_ENABLED_AT_KEY = "workbench.eventsEnabledAt";
export const WORKBENCH_RECONCILE_FAILURE_BACKOFF_MS = 60_000;
// Workbench batches are substantially larger than ordinary terminal messages.
// Claude Code keeps treating a CR as pasted content while it is still ingesting
// the preceding multi-line write, so the generic 80 ms bridge delay can leave the
// whole request sitting in the editor without submitting it.
const WORKBENCH_SUBMIT_DELAY_MS = 500;

export interface WorkbenchEventRecord {
  id: string;
  parentTaskId: string;
  sourceTaskId: string;
  executionId: string | null;
  kind: WorkbenchEventKind;
  priority: WorkbenchEventPriority;
  dedupKey: string;
  executionReviewKey: string | null;
  payload: string;
  attempts: number;
  createdAt: Date;
}

export interface WorkbenchDrainBatch {
  batchKey: string;
  generation: number;
  leaseToken: string;
  parentTaskId: string;
  parentExecutionId: string | null;
  eventIds: string[];
  events: WorkbenchEventRecord[];
  prompt: string;
}

export interface WorkbenchDrainResult {
  batchKey?: string;
  generation?: number;
  leaseToken?: string;
  eventCount: number;
  delivered: boolean;
}

export interface WorkbenchBatchTransitionResult {
  batchId: string;
  generation: number;
  state: "ACKED" | "RESOLVED";
  eventCount: number;
  noOp: boolean;
}

export type WorkbenchBatchDelivery = (batch: WorkbenchDrainBatch) => Promise<void>;
export type EnsureWorkbenchRunning = (taskId: string) => Promise<{
  mode: "already_running" | "continued" | "started";
  executionId: string | null;
}>;

export interface WorkbenchReconcileResult {
  scanned: number;
  woken: number;
  busy: number;
  failed: number;
}

export interface WorkbenchRuntimeSnapshot {
  taskId: string;
  executionId: string | null;
  generation: number;
  state: WorkbenchRuntimeState;
  activeBatchId: string | null;
  pendingEvents: number;
  oldestPendingAt: Date | null;
  lastHeartbeatAt: Date;
  lastTurnCompletedAt: Date | null;
  blockedReason: string | null;
  lastError: string | null;
}

export function deriveWorkbenchRuntimeState(input: {
  hasLiveSession: boolean;
  hasActiveBatch: boolean;
  isAtTurnBoundary: boolean;
}): WorkbenchRuntimeState {
  if (!input.hasLiveSession) return "DEGRADED";
  if (input.hasActiveBatch || !input.isAtTurnBoundary) return "BUSY";
  return "IDLE";
}

export function deriveWorkbenchBlockedReason(input: {
  hasLiveSession: boolean;
  hasActiveBatch: boolean;
  pendingEvents: number;
  isAtTurnBoundary: boolean;
}): string | null {
  if (!input.hasLiveSession) {
    return "Database execution is RUNNING but no live terminal session exists";
  }
  if (input.hasActiveBatch) return "Workbench is processing a durable batch";
  if (!input.isAtTurnBoundary) return "Provider turn in progress";
  if (input.pendingEvents > 0) return "Durable work is awaiting dispatch";
  return null;
}

/**
 * Refresh the persisted operational projection from the durable inbox plus the
 * current execution. Generation changes only when a different execution owns
 * the resident Workbench, making restarts visible without changing inbox ids.
 */
export async function recordWorkbenchRuntime(
  parentTaskId: string,
  state: WorkbenchRuntimeState,
  input: {
    activeBatchId?: string | null;
    blockedReason?: string | null;
    lastError?: string | null;
    turnCompleted?: boolean;
    executionId?: string | null;
  } = {},
): Promise<WorkbenchRuntimeSnapshot> {
  const [existing, execution, pending, oldest, activeBatch] = await Promise.all([
    db.workbenchRuntime.findUnique({ where: { taskId: parentTaskId } }),
    input.executionId === undefined
      ? db.taskExecution.findFirst({
          where: { taskId: parentTaskId, status: "RUNNING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : Promise.resolve(input.executionId ? { id: input.executionId } : null),
    db.workbenchEvent.count({
      where: { parentTaskId, state: { in: ["PENDING", "PROCESSING"] } },
    }),
    db.workbenchEvent.findFirst({
      where: { parentTaskId, state: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    input.activeBatchId === undefined
      ? db.workbenchBatch.findFirst({
          where: { parentTaskId, state: { in: ["CLAIMED", "DISPATCHED", "ACKED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : Promise.resolve(input.activeBatchId ? { id: input.activeBatchId } : null),
  ]);
  const executionId = execution?.id ?? null;
  const generation = existing
    ? existing.generation + (executionId && executionId !== existing.executionId ? 1 : 0)
    : 1;
  const now = new Date();
  return db.workbenchRuntime.upsert({
    where: { taskId: parentTaskId },
    create: {
      taskId: parentTaskId,
      executionId,
      generation,
      state,
      activeBatchId: activeBatch?.id ?? null,
      pendingEvents: pending,
      oldestPendingAt: oldest?.createdAt ?? null,
      lastHeartbeatAt: now,
      lastTurnCompletedAt: input.turnCompleted ? now : null,
      blockedReason: input.blockedReason ?? null,
      lastError: input.lastError ?? null,
    },
    update: {
      executionId,
      generation,
      state,
      activeBatchId: activeBatch?.id ?? null,
      pendingEvents: pending,
      oldestPendingAt: oldest?.createdAt ?? null,
      lastHeartbeatAt: now,
      ...(input.turnCompleted ? { lastTurnCompletedAt: now } : {}),
      blockedReason: input.blockedReason ?? null,
      lastError: input.lastError ?? null,
    },
  });
}

export async function heartbeatActiveWorkbenchRuntimes(): Promise<number> {
  const executions = await db.taskExecution.findMany({
    where: {
      status: "RUNNING",
      task: {
        labels: { some: { label: { name: "Tower", isBuiltin: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    distinct: ["taskId"],
    select: { id: true, taskId: true },
  });
  for (const execution of executions) {
    const session = getSession(execution.taskId);
    const [activeBatch, pendingEvents] = await Promise.all([
      db.workbenchBatch.findFirst({
        where: {
          parentTaskId: execution.taskId,
          state: { in: ["CLAIMED", "DISPATCHED", "ACKED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
      db.workbenchEvent.count({
        where: {
          parentTaskId: execution.taskId,
          state: { in: ["PENDING", "PROCESSING"] },
        },
      }),
    ]);
    const hasLiveSession = Boolean(session && !session.killed);
    const state = deriveWorkbenchRuntimeState({
      hasLiveSession,
      hasActiveBatch: Boolean(activeBatch),
      isAtTurnBoundary: session?.isAtTurnBoundary ?? false,
    });
    await recordWorkbenchRuntime(execution.taskId, state, {
      executionId: execution.id,
      activeBatchId: activeBatch?.id ?? null,
      blockedReason: deriveWorkbenchBlockedReason({
        hasLiveSession,
        hasActiveBatch: Boolean(activeBatch),
        pendingEvents,
        isAtTurnBoundary: session?.isAtTurnBoundary ?? false,
      }),
    });
  }
  return executions.length;
}

function countBatchEvents(eventIds: string): number {
  try {
    const parsed = JSON.parse(eventIds);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function childStopDedupKey(input: {
  taskId: string;
  executionId?: string | null;
  sessionId?: string | null;
  eventId?: string | null;
  lastReply?: string | null;
  kind: "CHILD_REVIEW_REQUIRED" | "CHILD_DECISION_REQUIRED";
}): string {
  const sourceEvent = input.eventId?.trim() || digest(input.lastReply?.trim() || "(empty-reply)");
  const execution = input.executionId?.trim() || input.sessionId?.trim() || "no-execution";
  return ["child-stop", input.kind, input.taskId, execution, sourceEvent].join(":");
}

export function childFailureDedupKey(taskId: string, executionId: string): string {
  return `child-exit:CHILD_EXECUTION_FAILED:${taskId}:${executionId}`;
}

export function childCompletionDedupKey(taskId: string, executionId: string): string {
  return `child-exit:CHILD_REVIEW_REQUIRED:${taskId}:${executionId}`;
}

function executionReviewGuardKey(taskId: string, executionId: string): string {
  return `execution-review:${taskId}:${executionId}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function enqueueWorkbenchEvent(input: EnqueueWorkbenchEventInput) {
  const executionReviewKey = input.reviewProducer && input.executionId
    ? executionReviewGuardKey(input.sourceTaskId, input.executionId)
    : null;
  const data = {
    parentTaskId: input.parentTaskId,
    sourceTaskId: input.sourceTaskId,
    executionId: input.executionId ?? null,
    kind: input.kind,
    priority: input.priority ?? "NORMAL",
    dedupKey: input.dedupKey,
    executionReviewKey,
    payload: JSON.stringify(input.payload),
  };
  let event;
  let deduped = false;
  try {
    event = await db.workbenchEvent.create({ data });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const exact = await db.workbenchEvent.findUnique({ where: { dedupKey: input.dedupKey } });
    if (exact) {
      event = exact;
      deduped = true;
    } else if (executionReviewKey) {
      const guardOwner = await db.workbenchEvent.findUnique({ where: { executionReviewKey } });
      if (!guardOwner) throw error;

      const guardOwnerIsFallback = guardOwner.dedupKey === childCompletionDedupKey(
        input.sourceTaskId,
        input.executionId!,
      );
      if (input.reviewProducer === "COMPLETION_FALLBACK" || guardOwnerIsFallback) {
        // The first producer for this execution already guaranteed one review.
        // A fallback never duplicates a stop event; a late stop never duplicates
        // a fallback that may already be scheduled or consumed.
        event = guardOwner;
        deduped = true;
      } else {
        // A prior stop turn owns the execution-level guard. This is a distinct
        // later stop turn, so retain per-turn semantics without competing for it.
        try {
          event = await db.workbenchEvent.create({
            data: { ...data, executionReviewKey: null },
          });
        } catch (retryError) {
          if (!isUniqueConstraintError(retryError)) throw retryError;
          event = await db.workbenchEvent.findUniqueOrThrow({ where: { dedupKey: input.dedupKey } });
          deduped = true;
        }
      }
    } else {
      throw error;
    }
  }

  scheduleReadyParentDrain(input.parentTaskId, input.priority ?? "NORMAL");
  return { event, deduped };
}

export async function enqueueChildExecutionResult(input: {
  taskId: string;
  taskTitle: string;
  executionId: string;
  status: "COMPLETED" | "FAILED";
  exitCode?: number;
}): Promise<{ enqueued: boolean; deduped?: boolean }> {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { parentTaskId: true },
  });
  if (!task?.parentTaskId) return { enqueued: false };

  const failed = input.status === "FAILED";
  const result = await enqueueWorkbenchEvent({
    parentTaskId: task.parentTaskId,
    sourceTaskId: input.taskId,
    executionId: input.executionId,
    kind: failed ? "CHILD_EXECUTION_FAILED" : "CHILD_REVIEW_REQUIRED",
    priority: failed ? "HIGH" : "NORMAL",
    dedupKey: failed
      ? childFailureDedupKey(input.taskId, input.executionId)
      : childCompletionDedupKey(input.taskId, input.executionId),
    reviewProducer: failed ? undefined : "COMPLETION_FALLBACK",
    payload: {
      childTaskId: input.taskId,
      childTitle: input.taskTitle,
      childReply: failed
        ? undefined
        : "Execution completed successfully without a provider stop-hook review event.",
      executionId: input.executionId,
      exitCode: input.exitCode,
    },
  });
  await import("@/lib/unattended-goal/policy").then(({ recordUnattendedGoalProgressFact }) =>
    recordUnattendedGoalProgressFact({
      taskId: task.parentTaskId!,
      kind: failed ? "CHILD_FAILED" : "CHILD_SUCCEEDED",
      dedupKey: `child-result:${input.executionId}:${input.status}`,
    }),
  ).catch((error) => {
    log.warn("Failed to record child result for unattended Goal budget", {
      parentTaskId: task.parentTaskId,
      childTaskId: input.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return { enqueued: true, deduped: result.deduped };
}

export function enqueueChildExecutionFailure(input: {
  taskId: string;
  taskTitle: string;
  executionId: string;
  exitCode?: number;
}) {
  return enqueueChildExecutionResult({ ...input, status: "FAILED" });
}

function parsePayload(event: WorkbenchEventRecord): WorkbenchEventPayload {
  try {
    return JSON.parse(event.payload) as WorkbenchEventPayload;
  } catch {
    return { childTaskId: event.sourceTaskId, childTitle: event.sourceTaskId };
  }
}

function eventHeading(kind: WorkbenchEventKind): string {
  switch (kind) {
    case "CHILD_DECISION_REQUIRED":
      return "DECISION REQUIRED";
    case "CHILD_EXECUTION_FAILED":
      return "EXECUTION FAILED";
    case "GATEWAY_WORK_REQUEST":
      return "GATEWAY WORK REQUEST";
    case "CAPABILITY_RESULT_AVAILABLE":
      return "CAPABILITY RESULT";
    case "GOAL_TIMER_DUE":
      return "GOAL TIMER DUE";
    case "GOAL_BLOCKED":
      return "GOAL BLOCKED";
    default:
      return "REVIEW REQUIRED";
  }
}

export function buildWorkbenchBatchPrompt(
  events: WorkbenchEventRecord[],
  batchKey: string,
  lease: { generation: number; leaseToken: string } = { generation: 1, leaseToken: "legacy" },
): string {
  const protocol = [
    "",
    `[Tower durable batch: ${batchKey}]`,
    `Delivery generation: ${lease.generation}`,
    `Delivery protocol: call ack_workbench_batch({ batchId: "${batchKey}", leaseToken: "${lease.leaseToken}" }) immediately after reading this request.`,
    `After every item in this batch has been handled or durably delegated, call resolve_workbench_batch({ batchId: "${batchKey}", leaseToken: "${lease.leaseToken}" }).`,
    "While responsibility remains unresolved, renew it with heartbeat_workbench_batch every two minutes using the same batch id and lease token; do not wait for the five-minute lease to expire.",
    "A replay with the same batch id is not new work; inspect existing task links/state and continue idempotently.",
  ].join("\n");

  if (events.length === 1 && events[0].kind === "CHILD_REVIEW_REQUIRED") {
    const payload = parsePayload(events[0]);
    return `${buildChildReviewPrompt({
      childTitle: payload.childTitle,
      childTaskId: payload.childTaskId,
      childReply: payload.childReply ?? "",
    })}${protocol}`;
  }

  if (events.length === 1 && events[0].kind === "GATEWAY_WORK_REQUEST") {
    const payload = parsePayload(events[0]);
    return `${payload.instruction || "[External project work request]\nNo instruction was stored."}${protocol}`;
  }

  if (events.length === 1 && events[0].kind === "CAPABILITY_RESULT_AVAILABLE") {
    const payload = parsePayload(events[0]);
    const uncertain = payload.status === "SIDE_EFFECT_UNKNOWN"
      ? "The external action may already have produced a side effect. Do not retry or submit a fallback request automatically."
      : null;
    return [[
      "[Tower external capability result]",
      `Task: ${payload.childTitle} (${payload.childTaskId})`,
      `Request: ${payload.requestId ?? "unknown"}`,
      `Capability: ${payload.capability ?? "unknown"}`,
      `Status: ${payload.status ?? "unknown"}`,
      `Revision: ${payload.revision ?? "unknown"}`,
      payload.jobRef ? `Job: ${payload.jobRef}` : null,
      payload.summary ? `Summary: ${payload.summary}` : null,
      payload.evidence?.length ? `Evidence: ${payload.evidence.join(", ")}` : null,
      uncertain,
      "Treat this persisted result as the wakeup fact for the current task/Goal. Continue from it idempotently; do not recreate the external request.",
    ].filter(Boolean).join("\n"), protocol].join("");
  }

  if (events.length === 1 && events[0].kind === "GOAL_TIMER_DUE") {
    const payload = parsePayload(events[0]);
    return [[
      "[Tower unattended Goal timer]",
      `Task: ${payload.childTitle} (${payload.childTaskId})`,
      `Scheduled check: ${payload.summary ?? "The persisted wakeup time is due"}`,
      "Re-evaluate the Goal from current durable project, child-task, ask, and capability state. Do not assume that elapsed time means an external action failed, and do not recreate requests that already have a requestId.",
    ].join("\n"), protocol].join("");
  }

  if (events.length === 1 && events[0].kind === "GOAL_BLOCKED") {
    const payload = parsePayload(events[0]);
    return [[
      "[Tower unattended Goal blocked]",
      `Task: ${payload.childTitle} (${payload.childTaskId})`,
      `Reason: ${payload.summary ?? "A persistent budget or watchdog guard was reached"}`,
      "Stop autonomous work. Preserve a concise progress and evidence summary, then notify the OWNER once through the bounded OWNER messaging path if a valid authorization remains. Never bypass an expired grant, recreate an external request, or report the Goal as complete.",
    ].join("\n"), protocol].join("");
  }

  const items = events.map((event, index) => {
    const payload = parsePayload(event);
    const detail = event.kind === "GATEWAY_WORK_REQUEST"
      ? (payload.instruction || "(no external work instruction)").slice(0, 8000)
      : event.kind === "CAPABILITY_RESULT_AVAILABLE"
        ? `Capability: ${payload.capability ?? "unknown"}; status: ${payload.status ?? "unknown"}; request: ${payload.requestId ?? "unknown"}; summary: ${(payload.summary || "(no summary)").slice(0, 1600)}`
      : event.kind === "GOAL_TIMER_DUE" || event.kind === "GOAL_BLOCKED"
        ? (payload.summary || "(no Goal detail)").slice(0, 1600)
      : event.kind === "CHILD_DECISION_REQUIRED"
      ? `Question: ${(payload.question || payload.childReply || "(no question text)").slice(0, 1600)}`
      : event.kind === "CHILD_EXECUTION_FAILED"
        ? `Execution: ${payload.executionId ?? event.executionId ?? "unknown"}; exit code: ${payload.exitCode ?? "unknown"}`
        : `Last reply: ${(payload.childReply || "(no text reply)").slice(0, 1600)}`;
    return `${index + 1}. [${eventHeading(event.kind)}] "${payload.childTitle}" (taskId: ${payload.childTaskId})\n   ${detail}`;
  });

  return [
    `[Tower] ${events.length} durable sub-task events are ready for supervisor review.`,
    `Batch: ${batchKey}`,
    "",
    ...items,
    "",
    "Review each item as the hub. Inspect the child's commits before terminal output when commits exist. Do not mark a child DONE until its result is verified. Answer decision requests downward; send concrete feedback for incomplete work; stop and move only verified work to DONE. Record the decisions in project notes.",
  ].join("\n") + protocol;
}

async function claimWorkbenchEvents(parentTaskId: string): Promise<{ token: string; events: WorkbenchEventRecord[] }> {
  const expiredBefore = new Date(Date.now() - WORKBENCH_CLAIM_LEASE_MS);
  return db.$transaction(async (tx) => {
    await tx.workbenchEvent.updateMany({
      where: {
        parentTaskId,
        state: "PROCESSING",
        batchId: null,
        OR: [{ claimedAt: { lt: expiredBefore } }, { claimedAt: null }],
      },
      data: { state: "PENDING", claimToken: null, claimedAt: null, batchId: null },
    });

    const pending = await tx.workbenchEvent.findMany({
      where: { parentTaskId, state: "PENDING" },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: WORKBENCH_MAX_BATCH_SIZE,
    });
    if (pending.length === 0) return { token: "", events: [] };

    const token = randomUUID();
    const claimedAt = new Date();
    await tx.workbenchEvent.updateMany({
      where: { id: { in: pending.map((event) => event.id) }, state: "PENDING" },
      data: {
        state: "PROCESSING",
        claimToken: token,
        claimedAt,
        attempts: { increment: 1 },
        batchId: null,
        lastError: null,
      },
    });
    const events = await tx.workbenchEvent.findMany({
      where: { parentTaskId, state: "PROCESSING", claimToken: token },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return { token, events: events as WorkbenchEventRecord[] };
  });
}

async function releaseClaim(token: string, error: unknown): Promise<void> {
  if (!token) return;
  const message = error instanceof Error ? error.message : String(error);
  await db.workbenchEvent.updateMany({
    where: { state: "PROCESSING", claimToken: token },
    data: {
      state: "PENDING",
      claimToken: null,
      claimedAt: null,
      batchId: null,
      lastError: message.slice(0, 2000),
    },
  });
}

export async function drainWorkbenchEvents(
  parentTaskId: string,
  deliver: WorkbenchBatchDelivery = deliverWorkbenchBatchToParent,
): Promise<WorkbenchDrainResult> {
  const { token, events } = await claimWorkbenchEvents(parentTaskId);
  if (events.length === 0) return { eventCount: 0, delivered: false };

  const batchKey = `wb-${digest(events.map((event) => event.dedupKey).sort().join("\n")).slice(0, 24)}`;
  const parentExecution = await db.taskExecution.findFirst({
    where: { taskId: parentTaskId, status: "RUNNING" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const runtime = await recordWorkbenchRuntime(parentTaskId, "BUSY", {
    executionId: parentExecution?.id ?? null,
    blockedReason: "Claiming durable Workbench batch",
  });
  const leaseToken = randomUUID();
  const claimedAt = new Date();
  const claimExpiresAt = new Date(claimedAt.getTime() + WORKBENCH_CLAIM_LEASE_MS);
  const prompt = buildWorkbenchBatchPrompt(events, batchKey, {
    generation: runtime.generation,
    leaseToken,
  });
  const batch: WorkbenchDrainBatch = {
    batchKey,
    generation: runtime.generation,
    leaseToken,
    parentTaskId,
    parentExecutionId: parentExecution?.id ?? null,
    eventIds: events.map((event) => event.id),
    events,
    prompt,
  };

  try {
    await db.$transaction(async (tx) => {
      await tx.workbenchBatch.upsert({
        where: { id: batchKey },
        update: {
          parentTaskId,
          eventIds: JSON.stringify(batch.eventIds),
          prompt: batch.prompt,
          state: "CLAIMED",
          generation: batch.generation,
          leaseToken: batch.leaseToken,
          leaseExpiresAt: claimExpiresAt,
          lastHeartbeatAt: claimedAt,
          lastError: null,
          dispatchedAt: null,
          ackedAt: null,
          resolvedAt: null,
        },
        create: {
          id: batchKey,
          parentTaskId,
          eventIds: JSON.stringify(batch.eventIds),
          prompt: batch.prompt,
          generation: batch.generation,
          leaseToken: batch.leaseToken,
          leaseExpiresAt: claimExpiresAt,
          lastHeartbeatAt: claimedAt,
        },
      });
      await tx.workbenchEvent.updateMany({
        where: { state: "PROCESSING", claimToken: token },
        data: { batchId: batchKey },
      });
      await tx.taskMessage.upsert({
        where: { id: batchKey },
        update: {
          executionId: batch.parentExecutionId,
          content: batch.prompt,
          metadata: JSON.stringify({
            type: "workbench_event_batch",
            batchKey,
            generation: batch.generation,
            leaseToken: batch.leaseToken,
            eventIds: batch.eventIds,
          }),
        },
        create: {
          id: batchKey,
          taskId: parentTaskId,
          executionId: batch.parentExecutionId,
          role: "SYSTEM",
          content: batch.prompt,
          metadata: JSON.stringify({
            type: "workbench_event_batch",
            batchKey,
            generation: batch.generation,
            leaseToken: batch.leaseToken,
            eventIds: batch.eventIds,
          }),
        },
      });
    });
    await deliver(batch);
    const dispatchedAt = new Date();
    const dispatched = await db.workbenchBatch.updateMany({
      where: { id: batchKey, state: "CLAIMED", leaseToken: batch.leaseToken },
      data: {
        state: "DISPATCHED",
        dispatchAttempts: { increment: 1 },
        dispatchedAt,
        leaseExpiresAt: new Date(dispatchedAt.getTime() + WORKBENCH_ACK_LEASE_MS),
        lastHeartbeatAt: dispatchedAt,
        lastError: null,
      },
    });
    if (dispatched.count !== 1) {
      throw new Error(`Workbench batch ${batchKey} lost its delivery lease before dispatch`);
    }
    await recordWorkbenchRuntime(parentTaskId, "BUSY", {
      activeBatchId: batchKey,
      blockedReason: "Waiting for Workbench batch acknowledgement",
    });
    await notifyWorkbenchBatchDispatched({
      batchId: batchKey,
      commands: events.map((event) => ({ kind: event.kind, payload: event.payload })),
    });
    return {
      batchKey,
      generation: batch.generation,
      leaseToken: batch.leaseToken,
      eventCount: events.length,
      delivered: true,
    };
  } catch (error) {
    await db.workbenchBatch.updateMany({
      where: {
        id: batchKey,
        state: { in: ["CLAIMED", "DISPATCHED"] },
        leaseToken: batch.leaseToken,
      },
      data: {
        state: "FAILED",
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      },
    }).catch(() => undefined);
    await releaseClaim(token, error);
    await recordWorkbenchRuntime(parentTaskId, "DEGRADED", {
      activeBatchId: batchKey,
      blockedReason: "Workbench batch delivery failed",
      lastError: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    log.warn("Workbench batch delivery failed; events returned to pending", {
      parentTaskId,
      batchKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      batchKey,
      generation: batch.generation,
      leaseToken: batch.leaseToken,
      eventCount: events.length,
      delivered: false,
    };
  }
}

export async function acknowledgeWorkbenchBatch(
  batchId: string,
  parentTaskId: string | undefined,
  leaseToken: string,
): Promise<WorkbenchBatchTransitionResult> {
  const boundParentTaskId = parentTaskId ?? (await db.workbenchBatch.findUnique({
    where: { id: batchId },
    select: { parentTaskId: true },
  }))?.parentTaskId;
  if (!boundParentTaskId) throw new Error(`Unknown Workbench batch: ${batchId}`);
  const result = await db.$transaction(async (tx) => {
    const batch = await tx.workbenchBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error(`Unknown Workbench batch: ${batchId}`);
    if (batch.parentTaskId !== boundParentTaskId) {
      throw new Error(`Workbench batch ${batchId} belongs to a different parent task`);
    }
    if (batch.state === "RESOLVED") {
      return {
        batchId,
        generation: batch.generation,
        state: batch.state,
        eventCount: countBatchEvents(batch.eventIds),
        noOp: true,
      };
    }
    if (batch.leaseToken !== leaseToken) {
      throw new Error(`Workbench batch ${batchId} lease token is stale`);
    }
    if (!batch.leaseExpiresAt || batch.leaseExpiresAt.getTime() <= Date.now()) {
      throw new Error(`Workbench batch ${batchId} lease has expired`);
    }
    if (batch.state === "ACKED") {
      const heartbeatAt = new Date();
      await tx.workbenchBatch.update({
        where: { id: batchId },
        data: {
          leaseExpiresAt: new Date(heartbeatAt.getTime() + WORKBENCH_PROCESSING_LEASE_MS),
          lastHeartbeatAt: heartbeatAt,
        },
      });
      return {
        batchId,
        generation: batch.generation,
        state: "ACKED" as const,
        eventCount: countBatchEvents(batch.eventIds),
        noOp: true,
      };
    }
    if (batch.state !== "DISPATCHED") {
      throw new Error(`Workbench batch ${batchId} is ${batch.state}, not DISPATCHED`);
    }
    const ackedAt = new Date();
    const eventCount = await tx.workbenchEvent.count({
      where: { batchId, state: "PROCESSING" },
    });
    await tx.workbenchBatch.update({
      where: { id: batchId },
      data: {
        state: "ACKED",
        ackedAt,
        leaseExpiresAt: new Date(ackedAt.getTime() + WORKBENCH_PROCESSING_LEASE_MS),
        lastHeartbeatAt: ackedAt,
        lastError: null,
      },
    });
    return {
      batchId,
      generation: batch.generation,
      state: "ACKED" as const,
      eventCount,
      noOp: false,
    };
  });
  await recordWorkbenchRuntime(boundParentTaskId, "BUSY", {
    activeBatchId: batchId,
    blockedReason: "Workbench acknowledged the batch and is processing it",
  });
  return result;
}

export async function resolveWorkbenchBatch(
  batchId: string,
  parentTaskId: string | undefined,
  leaseToken: string,
): Promise<WorkbenchBatchTransitionResult> {
  const boundParentTaskId = parentTaskId ?? (await db.workbenchBatch.findUnique({
    where: { id: batchId },
    select: { parentTaskId: true },
  }))?.parentTaskId;
  if (!boundParentTaskId) throw new Error(`Unknown Workbench batch: ${batchId}`);
  const result = await db.$transaction(async (tx) => {
    const batch = await tx.workbenchBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error(`Unknown Workbench batch: ${batchId}`);
    if (batch.parentTaskId !== boundParentTaskId) {
      throw new Error(`Workbench batch ${batchId} belongs to a different parent task`);
    }
    if (batch.state === "RESOLVED") {
      return {
        batchId,
        generation: batch.generation,
        state: "RESOLVED" as const,
        eventCount: countBatchEvents(batch.eventIds),
        noOp: true,
      };
    }
    if (batch.leaseToken !== leaseToken) {
      throw new Error(`Workbench batch ${batchId} lease token is stale`);
    }
    if (!batch.leaseExpiresAt || batch.leaseExpiresAt.getTime() <= Date.now()) {
      throw new Error(`Workbench batch ${batchId} lease has expired`);
    }
    if (batch.state !== "ACKED") {
      throw new Error(`Workbench batch ${batchId} must be ACKED before it can be resolved`);
    }
    const resolvedAt = new Date();
    const events = await tx.workbenchEvent.updateMany({
      where: { batchId, state: "PROCESSING" },
      data: {
        state: "CONSUMED",
        claimToken: null,
        claimedAt: null,
        consumedAt: resolvedAt,
        lastError: null,
      },
    });
    await tx.workbenchBatch.update({
      where: { id: batchId },
      data: {
        state: "RESOLVED",
        resolvedAt,
        leaseExpiresAt: null,
        lastHeartbeatAt: resolvedAt,
      },
    });
    return {
      batchId,
      generation: batch.generation,
      state: "RESOLVED" as const,
      eventCount: events.count,
      noOp: false,
    };
  });
  await recordWorkbenchRuntime(boundParentTaskId, "BUSY", {
    activeBatchId: null,
    blockedReason: "Batch resolved; provider turn is still in progress",
  });
  return result;
}

export async function recordWorkbenchProviderTurnCompleted(parentTaskId: string): Promise<boolean> {
  const [runtime, activeBatch] = await Promise.all([
    db.workbenchRuntime.findUnique({
      where: { taskId: parentTaskId },
      select: { taskId: true },
    }),
    db.workbenchBatch.findFirst({
      where: { parentTaskId, state: { in: ["CLAIMED", "DISPATCHED", "ACKED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);
  if (!runtime) return false;
  await recordWorkbenchRuntime(parentTaskId, activeBatch ? "BUSY" : "IDLE", {
    activeBatchId: activeBatch?.id ?? null,
    blockedReason: activeBatch ? "Provider turn completed with an active Workbench batch" : null,
    turnCompleted: true,
  });
  return true;
}

export async function heartbeatWorkbenchBatch(
  batchId: string,
  parentTaskId: string | undefined,
  leaseToken: string,
): Promise<{ batchId: string; generation: number; state: "ACKED"; leaseExpiresAt: Date }> {
  const boundParentTaskId = parentTaskId ?? (await db.workbenchBatch.findUnique({
    where: { id: batchId },
    select: { parentTaskId: true },
  }))?.parentTaskId;
  if (!boundParentTaskId) throw new Error(`Unknown Workbench batch: ${batchId}`);
  const heartbeatAt = new Date();
  const leaseExpiresAt = new Date(heartbeatAt.getTime() + WORKBENCH_PROCESSING_LEASE_MS);
  const updated = await db.workbenchBatch.updateMany({
    where: {
      id: batchId,
      parentTaskId: boundParentTaskId,
      state: "ACKED",
      leaseToken,
      leaseExpiresAt: { gt: heartbeatAt },
    },
    data: { lastHeartbeatAt: heartbeatAt, leaseExpiresAt },
  });
  if (updated.count !== 1) {
    throw new Error(`Workbench batch ${batchId} is not owned by this active lease`);
  }
  const batch = await db.workbenchBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { generation: true },
  });
  return { batchId, generation: batch.generation, state: "ACKED", leaseExpiresAt };
}

export async function deliverWorkbenchBatchToParent(batch: WorkbenchDrainBatch): Promise<void> {
  const session = getSession(batch.parentTaskId);
  if (!session || session.killed) throw new Error("Parent terminal is not running");
  const { body, submitKey } = planTerminalWrite(batch.prompt, true);
  if (body) session.write(body);
  if (submitKey) {
    await new Promise((resolve) => setTimeout(resolve, WORKBENCH_SUBMIT_DELAY_MS));
    const current = getSession(batch.parentTaskId);
    if (!current || current !== session || current.killed) {
      throw new Error("Parent terminal exited before batch submit");
    }
    current.write(submitKey);
  }
}

export async function drainReadyWorkbenchParent(
  parentTaskId: string,
  deliver: WorkbenchBatchDelivery = deliverWorkbenchBatchToParent,
): Promise<void> {
  if (!hasWorkbenchDrainBoundary(parentTaskId)) return;
  const pending = await db.workbenchEvent.count({
    where: { parentTaskId, state: "PENDING" },
  });
  if (pending === 0 || !takeWorkbenchDrainBoundary(parentTaskId)) return;
  const result = await drainWorkbenchEvents(parentTaskId, deliver);
  if (!result.delivered) {
    const session = getSession(parentTaskId);
    if (session && !session.killed) {
      markWorkbenchDrainBoundary(parentTaskId);
      scheduleReadyParentDrain(parentTaskId, "HIGH", 1000);
    }
  }
}

function scheduleReadyParentDrain(
  parentTaskId: string,
  priority: WorkbenchEventPriority,
  overrideDelay?: number,
): void {
  const delay = overrideDelay ?? (priority === "HIGH" ? WORKBENCH_HIGH_COALESCE_MS : WORKBENCH_NORMAL_COALESCE_MS);
  scheduleAtWorkbenchDrainBoundary(parentTaskId, delay, () => {
    void drainReadyWorkbenchParent(parentTaskId).catch((error) => {
      log.error("Scheduled Workbench drain failed", error, { parentTaskId });
    });
  });
}

export function openWorkbenchDrainBoundary(parentTaskId: string): void {
  markWorkbenchDrainBoundary(parentTaskId);
  scheduleReadyParentDrain(parentTaskId, "NORMAL");
}

/**
 * Recreate only the disposable drain token after a server/module restart. The
 * live PTY owns the stronger BUSY/IDLE fact, so recovery cannot inject into an
 * already-running agent turn merely because the in-memory token disappeared.
 */
export function restoreWorkbenchDrainBoundary(parentTaskId: string): boolean {
  const session = getSession(parentTaskId);
  if (!session || session.killed || !session.isAtTurnBoundary) return false;
  openWorkbenchDrainBoundary(parentTaskId);
  return true;
}

function claudeTranscriptEndedAtTurnBoundary(sessionId: string): boolean {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return false;
  }
  const filename = `${sessionId}.jsonl`;
  const transcriptPath = projectDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDir, entry.name, filename))
    .find((candidate) => fs.existsSync(candidate));
  if (!transcriptPath) return false;

  let fd: number | undefined;
  try {
    fd = fs.openSync(transcriptPath, "r");
    const stat = fs.fstatSync(fd);
    const length = Math.min(stat.size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    const lines = buffer.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]?.trim();
      if (!line) continue;
      let record: {
        type?: string;
        message?: { role?: string; stop_reason?: string | null };
      };
      try {
        record = JSON.parse(line) as typeof record;
      } catch {
        continue;
      }
      const role = record.message?.role;
      if (record.type !== "assistant" && record.type !== "user" && role !== "assistant" && role !== "user") {
        continue;
      }
      return (record.type === "assistant" || role === "assistant")
        && record.message?.stop_reason === "end_turn";
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return false;
}

/**
 * Recover the authoritative provider boundary when Tower missed the HTTP Stop
 * callback during a restart. Claude persists `stop_reason=end_turn` before it
 * invokes hooks, so this remains safe when terminal-output idleness would not.
 */
export async function restoreWorkbenchBoundaryFromProviderTranscript(parentTaskId: string): Promise<boolean> {
  const session = getSession(parentTaskId);
  if (!session || session.killed) return false;
  const execution = await db.taskExecution.findFirst({
    where: {
      taskId: parentTaskId,
      status: "RUNNING",
      agent: "CLAUDE_CODE",
      sessionId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { sessionId: true },
  });
  if (!execution?.sessionId || !claudeTranscriptEndedAtTurnBoundary(execution.sessionId)) return false;
  if (!markSessionTurnComplete(parentTaskId)) return false;
  openWorkbenchDrainBoundary(parentTaskId);
  return true;
}

async function defaultEnsureWorkbenchRunning(taskId: string) {
  const { continueOrStartTaskExecution } = await import("@/actions/agent-actions");
  const result = await continueOrStartTaskExecution(taskId);
  return { mode: result.mode, executionId: result.executionId };
}

/**
 * Database-driven Workbench consumer reconciliation.
 *
 * Enqueue-time timers are only a latency optimization. This scan is the durable
 * trigger: after a process/module restart, or when an enqueue happened while the
 * Workbench was busy, every PENDING parent is revisited until it can be safely
 * delivered at a provider-confirmed turn boundary.
 */
export async function reconcilePendingWorkbenchEvents(
  ensureWorkbench: EnsureWorkbenchRunning = defaultEnsureWorkbenchRunning,
  now = new Date(),
): Promise<WorkbenchReconcileResult> {
  const failedBefore = new Date(now.getTime() - WORKBENCH_RECONCILE_FAILURE_BACKOFF_MS);
  const parents = await db.workbenchEvent.findMany({
    where: {
      state: "PENDING",
      OR: [
        { lastError: null },
        { updatedAt: { lte: failedBefore } },
      ],
    },
    distinct: ["parentTaskId"],
    orderBy: { createdAt: "asc" },
    select: { parentTaskId: true },
  });
  const result: WorkbenchReconcileResult = {
    scanned: parents.length,
    woken: 0,
    busy: 0,
    failed: 0,
  };

  for (const { parentTaskId } of parents) {
    try {
      const live = getSession(parentTaskId);
      if (live && !live.killed) {
        if (
          !restoreWorkbenchDrainBoundary(parentTaskId)
          && !await restoreWorkbenchBoundaryFromProviderTranscript(parentTaskId)
        ) {
          await recordWorkbenchRuntime(parentTaskId, "BUSY", {
            blockedReason: "Provider turn in progress",
          });
          result.busy++;
          continue;
        }
      } else {
        const resumed = await ensureWorkbench(parentTaskId);
        if (resumed.mode === "already_running") {
          if (
            !restoreWorkbenchDrainBoundary(parentTaskId)
            && !await restoreWorkbenchBoundaryFromProviderTranscript(parentTaskId)
          ) {
            await recordWorkbenchRuntime(parentTaskId, "BUSY", {
              blockedReason: "Provider turn in progress",
            });
            result.busy++;
            continue;
          }
        } else {
          // A new CLI may still be booting or processing its startup prompt.
          // Wait for its provider callback (or persisted completion replay)
          // instead of inheriting the previous execution's turn boundary.
          await recordWorkbenchRuntime(parentTaskId, "STARTING", {
            executionId: resumed.executionId,
            blockedReason: "Waiting for the current execution's provider-confirmed turn boundary",
          });
          result.busy++;
          continue;
        }
      }
      await recordWorkbenchRuntime(parentTaskId, "IDLE", {
        blockedReason: null,
      });
      result.woken++;
    } catch (error) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      await db.workbenchEvent.updateMany({
        where: { parentTaskId, state: "PENDING" },
        data: { lastError: message.slice(0, 2000) },
      });
      await recordWorkbenchRuntime(parentTaskId, "BLOCKED", {
        blockedReason: "Workbench reconciliation failed",
        lastError: message,
      }).catch(() => undefined);
      log.warn("Pending Workbench event reconciliation failed", {
        parentTaskId,
        error: message,
      });
    }
  }
  return result;
}

export async function recoverWorkbenchEventClaims(now = new Date()): Promise<number> {
  const expiredBefore = new Date(now.getTime() - WORKBENCH_CLAIM_LEASE_MS);
  const ackExpiredBefore = new Date(now.getTime() - WORKBENCH_ACK_LEASE_MS);
  const recovery = await db.$transaction(async (tx) => {
    const expiredBatches = await tx.workbenchBatch.findMany({
      where: {
        OR: [
          {
            state: { in: ["CLAIMED", "DISPATCHED", "ACKED"] },
            leaseExpiresAt: { lt: now },
          },
          {
            state: "CLAIMED",
            leaseExpiresAt: null,
            updatedAt: { lt: expiredBefore },
          },
          {
            state: "DISPATCHED",
            leaseExpiresAt: null,
            dispatchedAt: { lt: ackExpiredBefore },
          },
          {
            state: "ACKED",
            leaseExpiresAt: null,
            ackedAt: { lt: new Date(now.getTime() - WORKBENCH_PROCESSING_LEASE_MS) },
          },
          { state: "FAILED" },
        ],
      },
      select: { id: true, parentTaskId: true, state: true },
    });
    const expiredBatchIds = expiredBatches.map((batch) => batch.id);
    const expired = await tx.workbenchEvent.findMany({
      where: {
        OR: [
          {
            state: "PROCESSING",
            batchId: null,
            claimedAt: { lt: expiredBefore },
          },
          {
            state: "PROCESSING",
            batchId: null,
            claimedAt: null,
          },
          ...(expiredBatchIds.length > 0
            ? [{
                state: { in: ["PROCESSING", "CONSUMED"] },
                batchId: { in: expiredBatchIds },
              } satisfies Prisma.WorkbenchEventWhereInput]
            : []),
        ],
      },
      select: { id: true, batchId: true, parentTaskId: true },
    });
    if (expired.length === 0) return { count: 0, parentTaskIds: [] as string[] };
    const batchIds = [...new Set(expired.flatMap((event) => event.batchId ? [event.batchId] : []))];
    if (batchIds.length > 0) {
      await tx.workbenchBatch.updateMany({
        where: { id: { in: batchIds }, state: { in: ["CLAIMED", "DISPATCHED", "ACKED", "FAILED"] } },
        data: {
          state: "FAILED",
          leaseExpiresAt: null,
          lastError: "Workbench batch responsibility lease expired; replaying the same batch id",
        },
      });
    }
    const result = await tx.workbenchEvent.updateMany({
      where: {
        id: { in: expired.map((event) => event.id) },
        state: { in: ["PROCESSING", "CONSUMED"] },
      },
      data: {
        state: "PENDING",
        claimToken: null,
        claimedAt: null,
        batchId: null,
        consumedAt: null,
        lastError: "Workbench responsibility lease expired; returned to pending for same-batch replay",
      },
    });
    const parentTaskIds = [...new Set(expired.map((event) => event.parentTaskId))];
    return { count: result.count, parentTaskIds };
  });
  for (const parentTaskId of recovery.parentTaskIds) {
    await recordWorkbenchRuntime(parentTaskId, "BLOCKED", {
      activeBatchId: null,
      blockedReason: "Batch responsibility lease expired; work returned to pending",
      lastError: "Workbench batch lease expired",
    }).catch(() => undefined);
  }
  return recovery.count;
}

export interface MissingWorkbenchExecutionRecoveryResult {
  checkpoint: Date | null;
  batches: number;
  scanned: number;
  recovered: number;
  failed: number;
  remaining: number;
  truncated: boolean;
  skipped: boolean;
}

export interface MissingWorkbenchExecutionRecoveryOptions {
  batchSize?: number;
  scanLimit?: number;
}

function parseWorkbenchCheckpoint(value: string): Date | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "string") return null;
    const date = new Date(parsed);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export async function recoverMissingWorkbenchExecutionEvents(
  options: MissingWorkbenchExecutionRecoveryOptions = {},
): Promise<MissingWorkbenchExecutionRecoveryResult> {
  const config = await db.systemConfig.findUnique({
    where: { key: WORKBENCH_EVENTS_ENABLED_AT_KEY },
    select: { value: true },
  });
  const checkpoint = config ? parseWorkbenchCheckpoint(config.value) : null;
  if (!checkpoint) {
    log.warn("Missing or invalid Workbench event recovery checkpoint; historical scan skipped");
    return {
      checkpoint: null,
      batches: 0,
      scanned: 0,
      recovered: 0,
      failed: 0,
      remaining: 0,
      truncated: false,
      skipped: true,
    };
  }

  const missingWhere: Prisma.TaskExecutionWhereInput = {
    endedAt: { gte: checkpoint },
    task: { parentTaskId: { not: null } },
    OR: [
      {
        status: "COMPLETED",
        workbenchEvents: {
          none: { kind: { in: ["CHILD_REVIEW_REQUIRED", "CHILD_DECISION_REQUIRED"] } },
        },
      },
      {
        status: "FAILED",
        workbenchEvents: { none: { kind: "CHILD_EXECUTION_FAILED" } },
      },
    ],
  };
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize! > 0
    ? options.batchSize!
    : WORKBENCH_RECOVERY_BATCH_SIZE;
  const scanLimit = Number.isInteger(options.scanLimit) && options.scanLimit! > 0
    ? options.scanLimit!
    : Number.POSITIVE_INFINITY;

  let batches = 0;
  let scanned = 0;
  let recovered = 0;
  let failed = 0;
  const failedExecutionIds: string[] = [];

  while (scanned < scanLimit) {
    const pageWhere: Prisma.TaskExecutionWhereInput = failedExecutionIds.length > 0
      ? {
          AND: [
            missingWhere,
            { id: { notIn: failedExecutionIds } },
          ],
        }
      : missingWhere;
    const executions = await db.taskExecution.findMany({
      where: pageWhere,
      orderBy: [{ endedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: Math.min(batchSize, scanLimit - scanned),
      select: {
        id: true,
        status: true,
        exitCode: true,
        task: { select: { id: true, title: true } },
      },
    });
    if (executions.length === 0) break;

    batches++;
    for (const execution of executions) {
      scanned++;
      try {
        const result = await enqueueChildExecutionResult({
          taskId: execution.task.id,
          taskTitle: execution.task.title,
          executionId: execution.id,
          status: execution.status as "COMPLETED" | "FAILED",
          exitCode: execution.exitCode ?? undefined,
        });
        if (result.enqueued && !result.deduped) recovered++;
      } catch (error) {
        failed++;
        failedExecutionIds.push(execution.id);
        log.error("Failed to recover missing Workbench execution event", error, {
          executionId: execution.id,
          taskId: execution.task.id,
          status: execution.status,
        });
      }
    }
  }

  const remaining = await db.taskExecution.count({ where: missingWhere });
  const unattempted = await db.taskExecution.count({
    where: failedExecutionIds.length > 0
      ? { AND: [missingWhere, { id: { notIn: failedExecutionIds } }] }
      : missingWhere,
  });
  const truncated = unattempted > 0;
  if (remaining > 0) {
    log.warn("Workbench execution-event recovery left records for a later retry", {
      scanned,
      recovered,
      failed,
      remaining,
      truncated,
    });
  }

  return {
    checkpoint,
    batches,
    scanned,
    recovered,
    failed,
    remaining,
    truncated,
    skipped: false,
  };
}
