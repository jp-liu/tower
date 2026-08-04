import type { Prisma } from "@prisma/client";

export type WorkbenchEventKind =
  | "CHILD_REVIEW_REQUIRED"
  | "CHILD_DECISION_REQUIRED"
  | "CHILD_EXECUTION_FAILED"
  | "GATEWAY_WORK_REQUEST"
  | "CAPABILITY_RESULT_AVAILABLE"
  | "GOAL_TIMER_DUE"
  | "GOAL_BLOCKED";

export type WorkbenchEventPriority = "NORMAL" | "HIGH";

export interface WorkbenchEventPayload {
  childTaskId: string;
  childTitle: string;
  childReply?: string;
  question?: string;
  executionId?: string;
  exitCode?: number;
  instruction?: string;
  sourceReference?: { namespace: string; id: string };
  requestId?: string;
  capability?: string;
  status?: string;
  revision?: string;
  summary?: string;
  evidence?: string[];
  jobRef?: string;
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

/** Persist a module command inside the caller's transaction. The regular
 * reconciler is the durable trigger, so no process-local drain timer is needed. */
export function persistWorkbenchCommand(
  tx: Pick<Prisma.TransactionClient, "workbenchEvent">,
  input: EnqueueWorkbenchEventInput,
) {
  return tx.workbenchEvent.upsert({
    where: { dedupKey: input.dedupKey },
    update: {},
    create: {
      parentTaskId: input.parentTaskId,
      sourceTaskId: input.sourceTaskId,
      executionId: input.executionId ?? null,
      kind: input.kind,
      priority: input.priority ?? "NORMAL",
      dedupKey: input.dedupKey,
      executionReviewKey: null,
      payload: JSON.stringify(input.payload),
    },
  });
}
