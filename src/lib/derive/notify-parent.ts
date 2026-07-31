/**
 * Compatibility producer for child-to-parent review notifications.
 *
 * This function intentionally does not touch the parent PTY. It persists a
 * deduplicated Workbench event; the coordinator drains it only at the parent's
 * completed-turn boundary.
 */
import { db } from "@/lib/db";
import {
  childStopDedupKey,
  publishWorkbenchCommand,
  type WorkbenchCommandKind,
} from "@/lib/workbench/command-inbox";

interface ChildStopContext {
  sessionId?: string;
  eventId?: string;
  executionId?: string | null;
}

async function persistChildStopEvent(input: {
  childTaskId: string;
  childTitle: string;
  lastReply: string;
  question?: string;
  kind: Extract<WorkbenchCommandKind, "CHILD_REVIEW_REQUIRED" | "CHILD_DECISION_REQUIRED">;
  context?: ChildStopContext;
}): Promise<{ enqueued: boolean; deduped?: boolean }> {
  const child = await db.task.findUnique({
    where: { id: input.childTaskId },
    select: { parentTaskId: true },
  });
  if (!child?.parentTaskId) return { enqueued: false };

  const result = await publishWorkbenchCommand({
    parentTaskId: child.parentTaskId,
    sourceTaskId: input.childTaskId,
    executionId: input.context?.executionId ?? null,
    kind: input.kind,
    priority: input.kind === "CHILD_DECISION_REQUIRED" ? "HIGH" : "NORMAL",
    reviewProducer: input.context?.executionId ? "STOP_HOOK" : undefined,
    dedupKey: childStopDedupKey({
      taskId: input.childTaskId,
      executionId: input.context?.executionId,
      sessionId: input.context?.sessionId,
      eventId: input.context?.eventId,
      lastReply: input.lastReply,
      kind: input.kind,
    }),
    payload: {
      childTaskId: input.childTaskId,
      childTitle: input.childTitle,
      childReply: input.lastReply,
      question: input.question,
      executionId: input.context?.executionId ?? undefined,
    },
  });
  return { enqueued: true, deduped: result.deduped };
}

export function notifyParentOnChildStop(
  childTaskId: string,
  childTitle: string,
  lastReply: string,
  context?: ChildStopContext,
) {
  return persistChildStopEvent({
    childTaskId,
    childTitle,
    lastReply,
    kind: "CHILD_REVIEW_REQUIRED",
    context,
  });
}

export function notifyParentOnChildDecision(
  childTaskId: string,
  childTitle: string,
  lastReply: string,
  question: string,
  context?: ChildStopContext,
) {
  return persistChildStopEvent({
    childTaskId,
    childTitle,
    lastReply,
    question,
    kind: "CHILD_DECISION_REQUIRED",
    context,
  });
}
