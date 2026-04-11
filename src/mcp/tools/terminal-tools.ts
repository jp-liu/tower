import { z } from "zod";
import { db } from "../db";

const BRIDGE_BASE = "http://localhost:3000/api/internal/terminal";

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BRIDGE_BASE}${path}`, init);
}

export const terminalTools = {
  get_task_terminal_output: {
    description:
      "Get recent terminal output lines from a running task's PTY session. Returns the last N lines (default 50, max 500).",
    schema: z.object({
      taskId: z.string(),
      lines: z.number().int().min(1).max(500).optional(),
    }),
    handler: async (args: { taskId: string; lines?: number }) => {
      const response = await bridgeFetch(`/${args.taskId}/buffer?lines=${args.lines ?? 50}`);

      if (response.status === 404) {
        return { error: "No active terminal session for this task", taskId: args.taskId };
      }

      if (response.ok) {
        const data = await response.json() as { taskId: string; lines: string[]; total: number; killed: boolean };
        return { taskId: data.taskId, lines: data.lines, total: data.total, killed: data.killed };
      }

      return { error: "Bridge request failed", status: response.status };
    },
  },

  send_task_terminal_input: {
    description:
      "Send text input to a running task's PTY terminal. The text is forwarded directly to the Claude CLI process. Include \\n for Enter key.",
    schema: z.object({
      taskId: z.string(),
      text: z.string().min(1).max(10000),
    }),
    handler: async (args: { taskId: string; text: string }) => {
      const response = await bridgeFetch(`/${args.taskId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: args.text }),
      });

      if (response.status === 404) {
        return { error: "No active terminal session for this task", taskId: args.taskId };
      }

      if (response.status === 410) {
        return { error: "Terminal session has exited", taskId: args.taskId };
      }

      if (response.ok) {
        return { ok: true, taskId: args.taskId };
      }

      return { error: "Bridge request failed", status: response.status };
    },
  },

  get_task_execution_status: {
    description:
      "Get the execution status of a task including whether its terminal is running, idle, or exited. Also returns a snippet of recent output.",
    schema: z.object({
      taskId: z.string(),
    }),
    handler: async (args: { taskId: string }) => {
      const execution = await db.taskExecution.findFirst({
        where: { taskId: args.taskId },
        orderBy: { createdAt: "desc" },
      });

      if (!execution) {
        return { error: "No execution found for this task", taskId: args.taskId };
      }

      const bufferResponse = await bridgeFetch(`/${args.taskId}/buffer?lines=10`);

      let terminalStatus: "running" | "exited" | "not_running";
      let outputSnippet: string | null = null;

      if (bufferResponse.status === 404) {
        // No active session — check DB status
        const doneStatuses = ["COMPLETED", "FAILED"];
        terminalStatus = doneStatuses.includes(execution.status) ? "exited" : "not_running";
      } else if (bufferResponse.ok) {
        const bufferData = await bufferResponse.json() as { lines: string[]; killed: boolean };
        terminalStatus = bufferData.killed ? "exited" : "running";
        if (bufferData.lines && bufferData.lines.length > 0) {
          outputSnippet = bufferData.lines.slice(-5).join("\n");
        }
      } else {
        terminalStatus = "not_running";
      }

      return {
        taskId: args.taskId,
        executionId: execution.id,
        executionStatus: execution.status,
        terminalStatus,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        outputSnippet,
      };
    },
  },
};
