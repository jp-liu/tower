import "server-only";

import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { buildChildReviewPrompt } from "@/lib/derive/child-review-prompt";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/pty/session-store";
import { planTerminalWrite } from "@/lib/pty/terminal-submit";
import {
  hasWorkbenchDrainBoundary,
  markWorkbenchDrainBoundary,
  scheduleAtWorkbenchDrainBoundary,
  takeWorkbenchDrainBoundary,
} from "./boundary";

const log = logger.create("workbench-coordinator");

export const WORKBENCH_NORMAL_COALESCE_MS = 750;
export const WORKBENCH_HIGH_COALESCE_MS = 100;
export const WORKBENCH_CLAIM_LEASE_MS = 60_000;
export const WORKBENCH_MAX_BATCH_SIZE = 50;
export const WORKBENCH_RECOVERY_BATCH_SIZE = 500;
export const WORKBENCH_EVENTS_ENABLED_AT_KEY = "workbench.eventsEnabledAt";
const SUBMIT_DELAY_MS = 80;

export type WorkbenchEventKind =
  | "CHILD_REVIEW_REQUIRED"
  | "CHILD_DECISION_REQUIRED"
  | "CHILD_EXECUTION_FAILED";

export type WorkbenchEventPriority = "NORMAL" | "HIGH";

export interface WorkbenchEventPayload {
  childTaskId: string;
  childTitle: string;
  childReply?: string;
  question?: string;
  executionId?: string;
  exitCode?: number;
}

export interface EnqueueWorkbenchEventInput {
  parentTaskId: string;
  sourceTaskId: string;
  executionId?: string | null;
  kind: WorkbenchEventKind;
  priority?: WorkbenchEventPriority;
  dedupKey: string;
  reviewProducer?: "STOP_HOOK" | "COMPLETION_FALLBACK";
  payload: WorkbenchEventPayload;
}

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
  parentTaskId: string;
  parentExecutionId: string | null;
  eventIds: string[];
  events: WorkbenchEventRecord[];
  prompt: string;
}

export interface WorkbenchDrainResult {
  batchKey?: string;
  eventCount: number;
  delivered: boolean;
}

export type WorkbenchBatchDelivery = (batch: WorkbenchDrainBatch) => Promise<void>;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function childStopDedupKey(input: {
  taskId: string;
  sessionId?: string | null;
  eventId?: string | null;
  lastReply?: string | null;
  kind: "CHILD_REVIEW_REQUIRED" | "CHILD_DECISION_REQUIRED";
}): string {
  const sourceEvent = input.eventId?.trim() || digest(input.lastReply?.trim() || "(empty-reply)");
  return ["child-stop", input.kind, input.taskId, input.sessionId?.trim() || "no-session", sourceEvent].join(":");
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
    default:
      return "REVIEW REQUIRED";
  }
}

export function buildWorkbenchBatchPrompt(events: WorkbenchEventRecord[], batchKey: string): string {
  if (events.length === 1 && events[0].kind === "CHILD_REVIEW_REQUIRED") {
    const payload = parsePayload(events[0]);
    return `${buildChildReviewPrompt({
      childTitle: payload.childTitle,
      childTaskId: payload.childTaskId,
      childReply: payload.childReply ?? "",
    })}\n\n[Tower durable batch: ${batchKey}]`;
  }

  const items = events.map((event, index) => {
    const payload = parsePayload(event);
    const detail = event.kind === "CHILD_DECISION_REQUIRED"
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
  ].join("\n");
}

async function claimWorkbenchEvents(parentTaskId: string): Promise<{ token: string; events: WorkbenchEventRecord[] }> {
  const expiredBefore = new Date(Date.now() - WORKBENCH_CLAIM_LEASE_MS);
  return db.$transaction(async (tx) => {
    await tx.workbenchEvent.updateMany({
      where: {
        parentTaskId,
        state: "PROCESSING",
        OR: [{ claimedAt: { lt: expiredBefore } }, { claimedAt: null }],
      },
      data: { state: "PENDING", claimToken: null, claimedAt: null },
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
  const batch: WorkbenchDrainBatch = {
    batchKey,
    parentTaskId,
    parentExecutionId: parentExecution?.id ?? null,
    eventIds: events.map((event) => event.id),
    events,
    prompt: buildWorkbenchBatchPrompt(events, batchKey),
  };

  try {
    await db.taskMessage.upsert({
      where: { id: batchKey },
      update: {},
      create: {
        id: batchKey,
        taskId: parentTaskId,
        executionId: batch.parentExecutionId,
        role: "SYSTEM",
        content: batch.prompt,
        metadata: JSON.stringify({
          type: "workbench_event_batch",
          batchKey,
          eventIds: batch.eventIds,
        }),
      },
    });
    await deliver(batch);
    const consumedAt = new Date();
    await db.workbenchEvent.updateMany({
      where: { state: "PROCESSING", claimToken: token },
      data: {
        state: "CONSUMED",
        claimToken: null,
        claimedAt: null,
        consumedAt,
        lastError: null,
      },
    });
    return { batchKey, eventCount: events.length, delivered: true };
  } catch (error) {
    await releaseClaim(token, error);
    log.warn("Workbench batch delivery failed; events returned to pending", {
      parentTaskId,
      batchKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return { batchKey, eventCount: events.length, delivered: false };
  }
}

export async function deliverWorkbenchBatchToParent(batch: WorkbenchDrainBatch): Promise<void> {
  const session = getSession(batch.parentTaskId);
  if (!session || session.killed) throw new Error("Parent terminal is not running");
  const { body, submitKey } = planTerminalWrite(batch.prompt, true);
  if (body) session.write(body);
  if (submitKey) {
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
    const current = getSession(batch.parentTaskId);
    if (!current || current !== session || current.killed) {
      throw new Error("Parent terminal exited before batch submit");
    }
    current.write(submitKey);
  }
}

async function drainReadyParent(parentTaskId: string): Promise<void> {
  if (!hasWorkbenchDrainBoundary(parentTaskId)) return;
  const pending = await db.workbenchEvent.count({
    where: { parentTaskId, state: "PENDING" },
  });
  if (pending === 0 || !takeWorkbenchDrainBoundary(parentTaskId)) return;
  const result = await drainWorkbenchEvents(parentTaskId);
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
    void drainReadyParent(parentTaskId).catch((error) => {
      log.error("Scheduled Workbench drain failed", error, { parentTaskId });
    });
  });
}

export function openWorkbenchDrainBoundary(parentTaskId: string): void {
  markWorkbenchDrainBoundary(parentTaskId);
  scheduleReadyParentDrain(parentTaskId, "NORMAL");
}

export async function recoverWorkbenchEventClaims(now = new Date()): Promise<number> {
  const expiredBefore = new Date(now.getTime() - WORKBENCH_CLAIM_LEASE_MS);
  const result = await db.workbenchEvent.updateMany({
    where: {
      state: "PROCESSING",
      OR: [{ claimedAt: { lt: expiredBefore } }, { claimedAt: null }],
    },
    data: { state: "PENDING", claimToken: null, claimedAt: null },
  });
  return result.count;
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
