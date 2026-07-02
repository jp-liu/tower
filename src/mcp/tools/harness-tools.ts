import { z } from "zod";

const PORT = process.env.PORT ?? "3000";
const BRIDGE = `http://localhost:${PORT}/api/internal/harness`;
const CUID_RE = /^c[a-z0-9]{20,30}$/;

function validateMcpTaskId(taskId: string): string | null {
  if (!CUID_RE.test(taskId)) return "Invalid taskId format — expected CUID";
  return null;
}

export const harnessTools = {
  ask_human: {
    description:
      "Ask the human operator a question and PARK the task until they reply. " +
      "Call this ONLY when you are blocked on a decision you cannot make yourself, " +
      "or before a dangerous/irreversible action that needs sign-off. " +
      "This ENDS your turn — do NOT keep working after calling it. The task is suspended " +
      "(its terminal is closed to save resources) and later resumed with the human's answer " +
      "as your next message. In unattended mode the question is pushed to the operator's channel (e.g. Feishu); " +
      "otherwise it waits visibly in the Tower UI.",
    schema: z.object({
      taskId: z.string().describe("The current task id (TOWER_TASK_ID)"),
      question: z.string().min(1).max(4000).describe("The question / options for the human"),
    }),
    handler: async (args: { taskId: string; question: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };

      const res = await fetch(`${BRIDGE}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: args.taskId, question: args.question }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: data?.error ?? "ask failed", status: res.status };

      return {
        parked: true,
        requestId: data.requestId,
        notified: data.notified,
        message:
          "Question posted and task parked. Your turn is over — stop now and wait. " +
          "You will be resumed with the human's answer as your next message.",
      };
    },
  },

  notify_human: {
    description:
      "Send a NON-BLOCKING progress update / heads-up to the human operator, then KEEP WORKING. " +
      "Unlike ask_human this does not park the task or end your turn — use it for milestones, " +
      "status reports, or FYI notes that need no reply. In unattended mode it is pushed to the " +
      "operator's channel (no @mention); otherwise it is a no-op.",
    schema: z.object({
      taskId: z.string().describe("The current task id (TOWER_TASK_ID)"),
      message: z.string().min(1).max(4000).describe("The progress update for the human"),
    }),
    handler: async (args: { taskId: string; message: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };

      const res = await fetch(`${BRIDGE}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: args.taskId, message: args.message }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { error: data?.error ?? "notify failed", status: res.status };

      return { ok: true, notified: data.notified };
    },
  },
};
