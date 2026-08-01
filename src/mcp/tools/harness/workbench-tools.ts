import { z } from "zod";
import { GATEWAY_BRIDGE, WORKBENCH_BATCH_BRIDGE, fetch } from "./shared";

export const workbenchTools = {
  ack_workbench_batch: {
    description:
      "Workbench-only: acknowledge that the resident Workbench actually received and read a durable batch. " +
      "Call this immediately when a prompt contains '[Tower durable batch: wb-...]'. PTY delivery alone does " +
      "not consume the inbox rows; only resolve_workbench_batch releases responsibility. The lease token fences " +
      "stale Workbench executions. Repeated calls renew the processing lease and are idempotent.",
    schema: z.object({
      batchId: z.string().trim().min(1).max(128),
      leaseToken: z.string().trim().min(1).max(128),
    }),
    handler: async (args: { batchId: string; leaseToken: string }) => {
      const parentTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!parentTaskId) return { error: "ack_workbench_batch must run inside the bound Workbench terminal" };
      const res = await fetch(WORKBENCH_BATCH_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ack", parentTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : {
        error: (data as { error?: unknown }).error ?? "Workbench batch acknowledgement failed",
        status: res.status,
      };
    },
  },

  heartbeat_workbench_batch: {
    description:
      "Workbench-only: renew an ACKED durable batch responsibility lease while long-running review/delegation " +
      "continues. Use the exact leaseToken from the batch prompt. A stale token is rejected.",
    schema: z.object({
      batchId: z.string().trim().min(1).max(128),
      leaseToken: z.string().trim().min(1).max(128),
    }),
    handler: async (args: { batchId: string; leaseToken: string }) => {
      const parentTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!parentTaskId) return { error: "heartbeat_workbench_batch must run inside the bound Workbench terminal" };
      const res = await fetch(WORKBENCH_BATCH_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", parentTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : {
        error: (data as { error?: unknown }).error ?? "Workbench batch heartbeat failed",
        status: res.status,
      };
    },
  },

  resolve_workbench_batch: {
    description:
      "Workbench-only: mark an acknowledged durable batch fully handled. Call only after every item in the " +
      "batch has been completed or durably delegated. The batch must be ACKED first; repeated calls are idempotent.",
    schema: z.object({
      batchId: z.string().trim().min(1).max(128),
      leaseToken: z.string().trim().min(1).max(128),
    }),
    handler: async (args: { batchId: string; leaseToken: string }) => {
      const parentTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!parentTaskId) return { error: "resolve_workbench_batch must run inside the bound Workbench terminal" };
      const res = await fetch(WORKBENCH_BATCH_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve", parentTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : {
        error: (data as { error?: unknown }).error ?? "Workbench batch resolution failed",
        status: res.status,
      };
    },
  },

  confirm_gateway_task_created: {
    description:
      "Workbench-only: confirm a PROJECT_WORK request after create_task actually returned the child task id. " +
      "Tower validates the task belongs to the bound project and sends one idempotent confirmation containing " +
      "the title and Tower locator. Never call before create_task succeeds.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
      taskId: z.string().min(1).max(128).describe("The real task id returned by create_task"),
    }),
    handler: async (args: { inboundId: string; taskId: string }) => {
      const reviewerTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!reviewerTaskId) return { error: "confirm_gateway_task_created must run inside the bound Workbench terminal" };
      const res = await fetch(GATEWAY_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "task_created", reviewerTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "task confirmation failed", status: res.status };
    },
  },

  complete_gateway_work: {
    description:
      "Workbench-only: after reviewing and accepting a gateway-created child task, reply to the original external " +
      "thread with the task title, reviewed result, commit id/message, branch, and Tower task locator. Tower " +
      "requires the caller to be the bound Workbench and the task to be IN_REVIEW (or already DONE for recovery). " +
      "This call atomically moves an accepted IN_REVIEW task to DONE and creates its retryable FINAL_RESULT outbox; " +
      "do not call move_task(DONE) first. Repeated callbacks are idempotent.",
    schema: z.object({
      inboundId: z.string().min(1).max(128),
      taskId: z.string().min(1).max(128),
      resultSummary: z.string().min(1).max(8000).optional(),
    }),
    handler: async (args: { inboundId: string; taskId: string; resultSummary?: string }) => {
      const reviewerTaskId = process.env.TOWER_TASK_ID?.trim();
      if (!reviewerTaskId) return { error: "complete_gateway_work must run inside the bound Workbench terminal" };
      const res = await fetch(GATEWAY_BRIDGE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "final", reviewerTaskId, ...args }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { error: (data as { error?: unknown }).error ?? "final gateway delivery failed", status: res.status };
    },
  },
};
