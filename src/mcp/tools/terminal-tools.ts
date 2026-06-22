import { z } from "zod";
import { db } from "../db";

const PORT = process.env.PORT ?? "3000";
const BRIDGE_BASE = `http://localhost:${PORT}/api/internal/terminal`;
const CUID_RE = /^c[a-z0-9]{20,30}$/;

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BRIDGE_BASE}${path}`, init);
}

function validateMcpTaskId(taskId: string): string | null {
  if (!CUID_RE.test(taskId)) return "Invalid taskId format — expected CUID";
  return null;
}

type TaskCandidate = {
  taskId: string;
  title: string;
  status: string;
  project: string;
  workspace: string;
};

type ResolvedTarget =
  | { targetId: string; targetTitle: string }
  | { error: string; taskId?: string; taskName?: string }
  | { needsSelection: true; message: string; candidates: TaskCandidate[] };

/**
 * Resolve a task from an exact `taskId` or a fuzzy `taskName`, shared by the
 * stop/resume terminal tools. Returns `{ targetId, targetTitle }` on a unique
 * hit, an `error` object when nothing matches, or `needsSelection` + candidates
 * when a name is ambiguous (so the caller can pick one rather than guessing).
 */
async function resolveTaskTarget(args: {
  taskId?: string;
  taskName?: string;
}): Promise<ResolvedTarget> {
  const name = args.taskName?.trim();
  if (!args.taskId && !name) {
    return { error: "Provide either taskId or taskName" };
  }

  if (args.taskId) {
    const err = validateMcpTaskId(args.taskId);
    if (err) return { error: err, taskId: args.taskId };
    const task = await db.task.findUnique({
      where: { id: args.taskId },
      select: { id: true, title: true },
    });
    if (!task) return { error: "Task not found", taskId: args.taskId };
    return { targetId: task.id, targetTitle: task.title };
  }

  // Fuzzy name search — list candidates rather than guessing on ambiguity.
  const matches = await db.task.findMany({
    where: { title: { contains: name } },
    select: {
      id: true,
      title: true,
      status: true,
      project: { select: { name: true, workspace: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  if (matches.length === 0) {
    return { error: "No task found matching the given name", taskName: name };
  }

  // Resolve to a single task when unambiguous: one fuzzy hit, or exactly one
  // exact (case-insensitive) title match among several fuzzy hits.
  const exact = matches.filter((m) => m.title.toLowerCase() === name!.toLowerCase());
  const resolved = matches.length === 1 ? matches[0] : exact.length === 1 ? exact[0] : null;

  if (!resolved) {
    return {
      needsSelection: true,
      message: `Multiple tasks match "${name}". Call again with one of these taskId values.`,
      candidates: matches.map((m) => ({
        taskId: m.id,
        title: m.title,
        status: m.status,
        project: m.project.name,
        workspace: m.project.workspace.name,
      })),
    };
  }

  return { targetId: resolved.id, targetTitle: resolved.title };
}

export const terminalTools = {
  start_task_execution: {
    description:
      "Start a Claude CLI terminal session for a task. The prompt is sent as the initial instruction. The task status will change to IN_PROGRESS. Returns executionId and worktreePath (if worktree mode).",
    schema: z.object({
      taskId: z.string(),
      prompt: z.string().optional(),
    }),
    handler: async (args: { taskId: string; prompt?: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };
      const tid = encodeURIComponent(args.taskId);
      const response = await bridgeFetch(`/${tid}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: args.prompt ?? "" }),
      });

      if (response.ok) {
        const data = await response.json();
        return { ok: true, ...data };
      }

      const errData = await response.json().catch(() => ({}));
      return { error: (errData as Record<string, unknown>).error ?? "Failed to start execution", status: response.status };
    },
  },

  get_task_terminal_output: {
    description:
      "Get recent terminal output lines from a running task's PTY session. Returns the last N lines (default 50, max 500).",
    schema: z.object({
      taskId: z.string(),
      lines: z.number().int().min(1).max(500).optional(),
    }),
    handler: async (args: { taskId: string; lines?: number }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };
      const tid = encodeURIComponent(args.taskId);
      const response = await bridgeFetch(`/${tid}/buffer?lines=${args.lines ?? 50}`);

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
      "Send text input to a running task's PTY terminal (e.g. the Claude CLI). By default the message is submitted: trailing newlines are trimmed and a real carriage return is appended so the TUI input box actually sends it. Pass submit:false to only fill the input box without submitting (the text is forwarded verbatim).",
    schema: z.object({
      taskId: z.string(),
      text: z.string().min(1).max(10000),
      submit: z.boolean().optional(),
    }),
    handler: async (args: { taskId: string; text: string; submit?: boolean }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };
      const tid = encodeURIComponent(args.taskId);
      const submit = args.submit ?? true;
      // Submit semantics live in the bridge route: it trims trailing newlines and
      // delivers a standalone CR as a separate keystroke so the TUI actually submits.
      const response = await bridgeFetch(`/${tid}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: args.text, submit }),
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

  stop_task_execution: {
    description:
      "Stop (close) a task's terminal/PTY session — the same action as the Stop button. " +
      "Identify the task either by exact `taskId` or by a fuzzy `taskName`. " +
      "If the terminal is running it is closed; if it was never started this is a no-op. Both cases report success. " +
      "When `taskName` matches multiple tasks it does NOT stop any of them — it returns `needsSelection` with the candidate list (id, title, status, project) so you can pick one and call again with that `taskId`. " +
      "A unique name match or an exact `taskId` is closed directly.",
    schema: z.object({
      taskId: z.string().optional(),
      taskName: z.string().optional(),
    }),
    handler: async (args: { taskId?: string; taskName?: string }) => {
      const target = await resolveTaskTarget(args);
      if (!("targetId" in target)) return target;
      const { targetId, targetTitle } = target;

      // Close via the internal bridge — reuses the Stop button logic (stopPtyExecution).
      const tid = encodeURIComponent(targetId);
      const response = await bridgeFetch(`/${tid}/stop`, { method: "POST" });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return {
          error: (errData as Record<string, unknown>).error ?? "Failed to stop terminal",
          status: response.status,
          taskId: targetId,
        };
      }

      const data = (await response.json().catch(() => ({}))) as { wasRunning?: boolean };
      const wasRunning = data.wasRunning ?? false;
      return {
        ok: true,
        taskId: targetId,
        title: targetTitle,
        wasRunning,
        message: wasRunning
          ? "Terminal closed"
          : "No active terminal for this task — nothing to close",
      };
    },
  },

  resume_task_execution: {
    description:
      "Start (launch) a task's terminal so you can interact with it — e.g. when a related task needs to notify a sibling that hasn't been started yet. " +
      "By default it resumes the latest history session (the Continue/Retry button); a task with no prior runs is started fresh with its task context (the Launch button). " +
      "If a terminal is already running this is a no-op and reports `mode: already_running`. " +
      "Identify the task by exact `taskId` or fuzzy `taskName` (ambiguous name → `needsSelection` with candidates; unique match or exact id → started directly). " +
      "After it is running, use `send_task_terminal_input` to send the actual message.",
    schema: z.object({
      taskId: z.string().optional(),
      taskName: z.string().optional(),
    }),
    handler: async (args: { taskId?: string; taskName?: string }) => {
      const target = await resolveTaskTarget(args);
      if (!("targetId" in target)) return target;
      const { targetId, targetTitle } = target;

      // Launch via the internal bridge — reuses the Continue/Retry + Launch button logic.
      const tid = encodeURIComponent(targetId);
      const response = await bridgeFetch(`/${tid}/resume`, { method: "POST" });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return {
          error: (errData as Record<string, unknown>).error ?? "Failed to start terminal",
          status: response.status,
          taskId: targetId,
        };
      }

      const data = (await response.json().catch(() => ({}))) as {
        mode?: "already_running" | "continued" | "started";
        executionId?: string | null;
        worktreePath?: string | null;
      };
      const mode = data.mode ?? "started";
      const messages: Record<string, string> = {
        already_running: "Terminal already running — ready for input",
        continued: "Terminal resumed from latest history",
        started: "Terminal started fresh",
      };
      return {
        ok: true,
        taskId: targetId,
        title: targetTitle,
        mode,
        executionId: data.executionId ?? null,
        worktreePath: data.worktreePath ?? null,
        message: messages[mode] ?? "Terminal started",
      };
    },
  },

  get_task_execution_status: {
    description:
      "Get the execution status of a task including whether its terminal is running, idle, or exited. Also returns a snippet of recent output.",
    schema: z.object({
      taskId: z.string(),
    }),
    handler: async (args: { taskId: string }) => {
      const err = validateMcpTaskId(args.taskId);
      if (err) return { error: err, taskId: args.taskId };

      const execution = await db.taskExecution.findFirst({
        where: { taskId: args.taskId },
        orderBy: { createdAt: "desc" },
      });

      if (!execution) {
        return { error: "No execution found for this task", taskId: args.taskId };
      }

      const tid = encodeURIComponent(args.taskId);
      const bufferResponse = await bridgeFetch(`/${tid}/buffer?lines=10`);

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
