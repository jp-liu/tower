"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createWorktree } from "@/lib/worktree";
import { resolveWorktreeBranch, DEFAULT_BRANCH_PREFIX } from "@/lib/worktree-branch";
import { createSession, destroySession } from "@/lib/pty/session-store";
import { logger } from "@/lib/logger";
import { readConfigValue } from "@/lib/config-reader";
import {
  resolveFixedCliConnection,
  resolveTerminalTargetPlan,
  type ResolvedCapabilityTarget,
} from "@/lib/ai/capability-resolver";
import { recordCapabilityAttemptService } from "@/lib/ai/capability-config-service";
import {
  reconcileTerminalCapabilityTargets,
  reconcileTerminalExecutionBinding,
} from "@/lib/ai/provider-reconciliation";
import {
  buildTerminalLaunch,
  resolveExecutionTerminalTarget,
  terminalTargetSnapshot,
  type TerminalLaunch,
  type TerminalTargetSnapshot,
} from "@/lib/ai/terminal-target";
import { cancelOpenAsks } from "@/lib/harness/harness-message";
import { writeFile, rm, mkdtemp, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { getSignalDir } from "@/lib/tower-dir";
import { TOWER_LABEL_NAME } from "@/lib/constants";
import { redactSecretString } from "@/lib/secret-redaction";
import {
  capabilityError,
  executeTerminalPrestartFallback,
  normalizeCapabilityError,
} from "@tower-org/ai-runtime";

export interface ActiveExecutionInfo {
  executionId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  projectAlias: string | null;
  projectLocalPath: string | null;
  workspaceId: string;
  workspaceName: string;
  worktreePath: string | null;
  subPath: string | null;
  startedAt: string | null; // ISO string for serialization
  /** Task carries the builtin "Tower" label → a system/workbench task, not completable via merge. */
  isSystemTask: boolean;
  workbenchRuntime: {
    generation: number;
    state: "STARTING" | "IDLE" | "BUSY" | "BLOCKED" | "DEGRADED" | "STOPPED";
    activeBatchId: string | null;
    pendingEvents: number;
    lastHeartbeatAt: string;
    blockedReason: string | null;
    lastError: string | null;
  } | null;
}

export interface TerminalExecutionResult extends TerminalTargetSnapshot {
  executionId: string;
  worktreePath: string | null;
}

const log = logger.create("agent-actions");

function refreshWorkspaces(): void {
  try {
    revalidatePath("/workspaces");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("static generation store missing in revalidatePath")) {
      log.info("Skipped workspace revalidation outside a request context");
      return;
    }
    throw error;
  }
}

const SIGNAL_DIR = getSignalDir();

function taskEnvironment(input: {
  taskId: string;
  taskTitle: string;
  callbackUrl?: string;
  hasParent?: boolean;
  executionId?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    TOWER_MCP_PROFILE: "task",
    TOWER_TASK_ID: input.taskId,
    TOWER_TASK_TITLE: input.taskTitle,
    TOWER_STARTED_AT: new Date().toISOString(),
    TOWER_API_URL: `http://localhost:${process.env.PORT || "3000"}`,
    TOWER_SIGNAL_DIR: SIGNAL_DIR,
  };
  if (input.executionId) env.TOWER_EXECUTION_ID = input.executionId;
  if (input.callbackUrl) env.CALLBACK_URL = input.callbackUrl;
  if (input.hasParent) env.TOWER_HAS_PARENT = "1";
  return env;
}

async function failTerminalPrestart(input: {
  executionId: string;
  taskId: string;
  previousTaskStatus: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
  tempDir?: string;
  clearTargetSnapshot?: boolean;
}): Promise<void> {
  try {
    destroySession(input.taskId);
  } catch {
    // Continue restoring persistent state even if the session store is already torn down.
  }
  await Promise.all([
    db.taskExecution.updateMany({
      where: { id: input.executionId, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "FAILED",
        endedAt: new Date(),
        ...(input.clearTargetSnapshot
          ? { connectionId: null, modelId: null, targetId: null }
          : {}),
      },
    }).catch(() => {}),
    db.task.update({
      where: { id: input.taskId },
      data: { status: input.previousTaskStatus },
    }).catch(() => {}),
    input.tempDir
      ? rm(input.tempDir, { recursive: true, force: true }).catch(() => {})
      : Promise.resolve(),
  ]);
  refreshWorkspaces();
}

async function writeExitSignal(taskId: string, exitCode: number): Promise<void> {
  try {
    await mkdir(SIGNAL_DIR, { recursive: true, mode: 0o700 });
    await writeFile(join(SIGNAL_DIR, `exit-${taskId}`), String(exitCode), { mode: 0o600 });
  } catch {
    // Best-effort — notification degraded, not fatal
  }
}


export async function sendTaskMessage(taskId: string, content: string) {
  const userMessage = await db.taskMessage.create({
    data: {
      role: "USER",
      content: redactSecretString(content),
      taskId,
    },
  });

  refreshWorkspaces();
  return { userMessage };
}

export async function getTaskMessages(taskId: string) {
  return db.taskMessage.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
}

export async function startTaskExecution(
  taskId: string,
  agent: string = "CLAUDE_CODE",
  worktreePath?: string,
  worktreeBranch?: string
) {
  // This non-PTY compatibility entrypoint has no resolved Terminal target. It
  // intentionally leaves connectionId/modelId/targetId null (legacy-only row).
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent,
      status: "RUNNING",
      startedAt: new Date(),
      worktreePath: worktreePath ?? null,
      worktreeBranch: worktreeBranch ?? null,
    },
  });

  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS" },
  });

  refreshWorkspaces();
  return execution;
}

export async function stopTaskExecution(executionId: string, status: "COMPLETED" | "FAILED" = "FAILED") {
  const execution = await db.taskExecution.update({
    where: { id: executionId },
    data: { status, endedAt: new Date() },
  });
  refreshWorkspaces();
  return execution;
}

/**
 * Stop a running PTY session for a task. Kills the process, captures summary,
 * and updates the execution status to COMPLETED.
 */
export async function stopPtyExecution(taskId: string): Promise<void> {
  // Harness cleanup: task stopped → cancel any pending ask for it (CANCELLED). best-effort.
  await cancelOpenAsks(taskId).catch(() => {});
  const { destroySession, getSession } = await import("@/lib/pty/session-store");

  // Capture buffer before destroying
  const session = getSession(taskId);
  const terminalBuffer = session?.getBuffer() ?? "";

  // Find the RUNNING execution + task project for direct mode fallback
  const execution = await db.taskExecution.findFirst({
    where: { taskId, status: "RUNNING" },
    orderBy: { createdAt: "desc" },
  });
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { localPath: true } } },
  });

  // Destroy the PTY session (kills the process)
  destroySession(taskId);

  if (execution) {
    await db.taskExecution.update({
      where: { id: execution.id },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    // Transition task to IN_REVIEW; stopping also ends any tower-goal mode → clear the flag.
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_REVIEW", unattended: false },
    });

    // Capture summary — use worktreePath or project localPath for direct mode
    const summaryPath = execution.worktreePath || task?.project?.localPath || null;
    const { captureExecutionSummary } = await import("@/lib/execution-summary");
    await captureExecutionSummary(
      execution.id, taskId, 0, terminalBuffer, summaryPath, execution.forkCommit
    );
  }
  await db.workbenchRuntime.updateMany({
    where: { taskId },
    data: {
      executionId: execution?.id ?? null,
      state: "STOPPED",
      activeBatchId: null,
      blockedReason: "Workbench terminal was stopped",
      lastHeartbeatAt: new Date(),
    },
  });

  refreshWorkspaces();
}

export async function getTaskExecutions(taskId: string) {
  return db.taskExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    include: {
      insightNote: { select: { id: true, title: true, content: true } },
    },
  });
}

/**
 * Resume a previous CLI session for a task.
 * Reuses the existing TaskExecution record (same session = same execution).
 */
export async function resumePtyExecution(
  taskId: string,
  previousSessionId: string
): Promise<TerminalExecutionResult> {
  // Harness cleanup: manual session restart → cancel the old pending ask (/reply already answered it, so this is a no-op there).
  await cancelOpenAsks(taskId).catch(() => {});
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) throw new Error("Task not found");
  if (!task.project?.localPath) throw new Error("Project has no local path configured");
  const previousTaskStatus = task.status;

  // Clean up stale RUNNING executions (not the one we're resuming)
  await db.taskExecution.updateMany({
    where: { taskId, status: "RUNNING", NOT: { sessionId: previousSessionId } },
    data: { status: "FAILED", endedAt: new Date() },
  });

  // Find the existing execution for this session — reuse it
  const prevExec = await db.taskExecution.findFirst({
    where: { taskId, sessionId: previousSessionId },
    orderBy: { createdAt: "desc" },
  });

  if (!prevExec) throw new Error("Previous execution not found");

  const baseCwd = prevExec.worktreePath ?? task.project.localPath;
  const cwd = task.subPath ? join(baseCwd, task.subPath) : baseCwd;

  // Read idle timeout from config
  const idleTimeoutSec = await readConfigValue<number>("terminal.idleTimeoutSec", 180);

  // Resume is pinned to the exact connection/model snapshot on the original execution.
  // Legacy rows are mapped once through their unique cli:<provider> connection.
  await reconcileTerminalExecutionBinding(prevExec, cwd);
  const fixedTarget = await resolveExecutionTerminalTarget(prevExec, cwd);
  const fixedSnapshot = terminalTargetSnapshot(fixedTarget);

  // Reuse execution: set back to RUNNING
  const execution = await db.taskExecution.update({
    where: { id: prevExec.id },
    data: {
      status: "RUNNING",
      endedAt: null,
      agent: fixedTarget.cli!.provider.agentFieldValue,
      ...fixedSnapshot,
    },
  });

  try {
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS" },
    });
    refreshWorkspaces();

    const usernameVal = await readConfigValue<string>("onboarding.username", "");

    const launch = await buildTerminalLaunch(fixedTarget, {
    prompt: "",
    cwd,
    mode: { type: "resume", sessionId: previousSessionId },
    model: fixedTarget.modelId,
    systemPrompt: usernameVal ? `The user's name is ${usernameVal}.` : undefined,
    envPatch: taskEnvironment({
      taskId,
      taskTitle: task.title,
      callbackUrl: prevExec.callbackUrl ?? undefined,
      hasParent: !!task.parentTaskId,
      executionId: execution.id,
    }),
    });

    createSession(
      taskId,
      launch.processSpec.command,
      launch.processSpec.args,
      cwd,
      () => {},
      async (exitCode) => {
      // Write exit code signal file for notify-agi.sh (runs before DB update)
      await writeExitSignal(taskId, exitCode);

      // Guard: if stopPtyExecution already handled this, skip
      const currentExec = await db.taskExecution.findUnique({ where: { id: execution.id } });
      if (currentExec?.status !== "RUNNING") return;

      const { getSession } = await import("@/lib/pty/session-store");
      const session = getSession(taskId);
      const terminalBuffer = session?.getBuffer() ?? "";

      const failure = exitCode !== 0
        ? launch.adapter.classifySessionFailure?.({
            mode: { type: "resume", sessionId: previousSessionId },
            exitCode,
            output: terminalBuffer,
          })
        : undefined;
      if (failure?.retryableWithFresh) {
        log.info("Session resume failed — retrying with fresh execution", { taskId, previousSessionId });
        await db.taskExecution.update({
          where: { id: execution.id },
          data: { status: "FAILED", endedAt: new Date() },
        }).catch(() => {});
        try {
          await startPtyExecution(taskId, task.title, undefined, undefined, false, fixedSnapshot);
        } catch (err) {
          log.error("Fresh execution retry also failed", err, { taskId });
          await db.task.update({
            where: { id: taskId },
            data: { status: previousTaskStatus },
          }).catch(() => {});
        }
        return;
      }

      await db.taskExecution.update({
        where: { id: execution.id },
        data: {
          status: exitCode === 0 ? "COMPLETED" : "FAILED",
          endedAt: new Date(),
        },
      }).catch(() => {});

      // Use worktreePath if available, otherwise fall back to project localPath (direct mode)
      const summaryPath = prevExec.worktreePath || task.project!.localPath;
      const { captureExecutionSummary } = await import("@/lib/execution-summary");
      await captureExecutionSummary(execution.id, taskId, exitCode, terminalBuffer, summaryPath, execution.forkCommit);

      // Dispatch task completion event for notification system (Phase 65)
      const { dispatchTaskCompletionEvent } = await import("@/actions/onboarding-actions");
      await dispatchTaskCompletionEvent({
        taskId,
        taskTitle: task.title,
        status: exitCode === 0 ? "COMPLETED" : "FAILED",
        executionId: execution.id,
        workspaceId: task.project.workspaceId,
      });

      if (exitCode === 0) {
        // Natural exit → IN_REVIEW; also ends tower-goal mode → clear the flag.
        // This is the resume/continue path (park → reply → exit), the MOST common
        // way a goal task ends — must clear here too, not only on fresh-start exit.
        await db.task.update({ where: { id: taskId }, data: { status: "IN_REVIEW", unattended: false } }).catch(() => {});
      }
      },
      launch.envOverrides,
      undefined,
      idleTimeoutSec * 1000,
      launch.processSpec.initialInput,
      launch.baseEnv,
    );
  } catch (error) {
    await failTerminalPrestart({
      executionId: execution.id,
      taskId,
      previousTaskStatus,
    });
    throw error;
  }

  return {
    executionId: execution.id,
    worktreePath: prevExec.worktreePath ?? baseCwd ?? null,
    ...fixedSnapshot,
  };
}

/**
 * Continue the most recent CLI session for a task (no sessionId needed).
 * Uses the fixed adapter's continue mode in the original isolated cwd.
 * Useful when a session was interrupted (crash, power loss) and sessionId was not captured.
 */
export async function continueLatestPtyExecution(
  taskId: string
): Promise<TerminalExecutionResult> {
  // Harness cleanup: manual restart (Continue button) → cancel the old pending ask.
  // When reached via /reply the task has no OPEN ask (answered before resume), so this is a no-op for that flow.
  await cancelOpenAsks(taskId).catch(() => {});
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) throw new Error("Task not found");
  if (!task.project?.localPath) throw new Error("Project has no local path configured");
  const previousTaskStatus = task.status;

  // Find the latest resumable terminal execution. Non-PTY compatibility rows
  // have no terminal binding, but historically defaulted `agent` to
  // CLAUDE_CODE. Treating one of those rows as terminal history would map it to
  // Claude and pin a fresh continuation there, bypassing the configured
  // Terminal capability slot.
  //
  // A captured session is resumable even when it predates target snapshots.
  // Without a session, require a non-legacy snapshot written by the PTY start
  // path. A legacy mapping without a session may have originated from a
  // compatibility row and is therefore not safe terminal history.
  const latestExec = await db.taskExecution.findFirst({
    where: {
      taskId,
      OR: [
        { sessionId: { not: null } },
        {
          connectionId: { not: null },
          targetId: { not: null },
          NOT: { targetId: { startsWith: "legacy:" } },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  if (latestExec?.sessionId) {
    const sameSessionOnOtherTask = await db.taskExecution.findFirst({
      where: { sessionId: latestExec.sessionId, NOT: { taskId } },
      select: { id: true },
    });
    if (!sameSessionOnOtherTask) {
      return resumePtyExecution(taskId, latestExec.sessionId);
    }
  }

  // Direct-mode tasks share the same project cwd. Without an explicit sessionId,
  // CLI continue mode resumes the latest conversation in that cwd, which may
  // belong to another Tower task. Only use --continue when the previous run had
  // an isolated worktree cwd; otherwise start fresh with task context.
  if (!latestExec?.worktreePath) {
    if (!latestExec) return startPtyExecution(taskId, task.title);
    const baseCwd = task.project.localPath;
    const cwd = task.subPath ? join(baseCwd, task.subPath) : baseCwd;
    const target = await resolveExecutionTerminalTarget(latestExec, cwd);
    return startPtyExecution(
      taskId,
      task.title,
      undefined,
      undefined,
      false,
      terminalTargetSnapshot(target),
    );
  }

  // Destroy any live PTY session for this task before spawning a new one
  const { destroySession: destroyExisting } = await import("@/lib/pty/session-store");
  destroyExisting(taskId);

  // Clean up stale RUNNING executions
  await db.taskExecution.updateMany({
    where: { taskId, status: "RUNNING" },
    data: { status: "FAILED", endedAt: new Date() },
  });

  const baseCwd = latestExec?.worktreePath ?? task.project.localPath;
  const cwd = task.subPath ? join(baseCwd, task.subPath) : baseCwd;

  const idleTimeoutSec = await readConfigValue<number>("terminal.idleTimeoutSec", 180);

  // Continue is fixed to the latest execution's exact connection and model.
  await reconcileTerminalExecutionBinding(latestExec, cwd);
  const fixedTarget = await resolveExecutionTerminalTarget(latestExec, cwd);
  const fixedSnapshot = terminalTargetSnapshot(fixedTarget);

  // Create a new execution record
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent: fixedTarget.cli!.provider.agentFieldValue,
      ...fixedSnapshot,
      status: "RUNNING",
      startedAt: new Date(),
      worktreePath: latestExec?.worktreePath ?? null,
      worktreeBranch: latestExec?.worktreeBranch ?? null,
    },
  });

  try {
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS" },
    });
    refreshWorkspaces();

    const usernameVal = await readConfigValue<string>("onboarding.username", "");

    const launch = await buildTerminalLaunch(fixedTarget, {
    prompt: "",
    cwd,
    mode: { type: "continue" },
    model: fixedTarget.modelId,
    systemPrompt: usernameVal ? `The user's name is ${usernameVal}.` : undefined,
    envPatch: taskEnvironment({
      taskId,
      taskTitle: task.title,
      hasParent: !!task.parentTaskId,
      executionId: execution.id,
    }),
    });

    createSession(
      taskId,
      launch.processSpec.command,
      launch.processSpec.args,
      cwd,
      () => {},
      async (exitCode) => {
      await writeExitSignal(taskId, exitCode);

      const currentExec = await db.taskExecution.findUnique({ where: { id: execution.id } });
      if (currentExec?.status !== "RUNNING") return;

      const { getSession } = await import("@/lib/pty/session-store");
      const session = getSession(taskId);
      const terminalBuffer = session?.getBuffer() ?? "";

      const failure = exitCode !== 0
        ? launch.adapter.classifySessionFailure?.({
            mode: { type: "continue" },
            exitCode,
            output: terminalBuffer,
          })
        : undefined;
      if (failure?.retryableWithFresh) {
        await db.taskExecution.update({
          where: { id: execution.id },
          data: { status: "FAILED", endedAt: new Date() },
        }).catch(() => {});
        try {
          await startPtyExecution(taskId, task.title, undefined, undefined, false, fixedSnapshot);
        } catch (err) {
          log.error("Fresh execution retry also failed", err, { taskId });
          await db.task.update({
            where: { id: taskId },
            data: { status: previousTaskStatus },
          }).catch(() => {});
        }
        return;
      }

      await db.taskExecution.update({
        where: { id: execution.id },
        data: {
          status: exitCode === 0 ? "COMPLETED" : "FAILED",
          endedAt: new Date(),
        },
      }).catch(() => {});

      const summaryPath = latestExec?.worktreePath || task.project!.localPath;
      const { captureExecutionSummary } = await import("@/lib/execution-summary");
      await captureExecutionSummary(execution.id, taskId, exitCode, terminalBuffer, summaryPath, latestExec?.forkCommit ?? null);

      // Dispatch task completion event for notification system (Phase 65)
      const { dispatchTaskCompletionEvent } = await import("@/actions/onboarding-actions");
      await dispatchTaskCompletionEvent({
        taskId,
        taskTitle: task.title,
        status: exitCode === 0 ? "COMPLETED" : "FAILED",
        executionId: execution.id,
        workspaceId: task.project.workspaceId,
      });

      if (exitCode === 0) {
        // Natural exit → IN_REVIEW; also ends tower-goal mode → clear the flag.
        // This is the resume/continue path (park → reply → exit), the MOST common
        // way a goal task ends — must clear here too, not only on fresh-start exit.
        await db.task.update({ where: { id: taskId }, data: { status: "IN_REVIEW", unattended: false } }).catch(() => {});
      }
      },
      launch.envOverrides,
      undefined,
      idleTimeoutSec * 1000,
      launch.processSpec.initialInput,
      launch.baseEnv,
    );
  } catch (error) {
    await failTerminalPrestart({
      executionId: execution.id,
      taskId,
      previousTaskStatus,
    });
    throw error;
  }

  return {
    executionId: execution.id,
    worktreePath: latestExec.worktreePath ?? baseCwd ?? null,
    ...fixedSnapshot,
  };
}

/**
 * Ensure a task's terminal is running, mirroring the task-detail buttons.
 *
 * - Live PTY session already up → no-op, returns `already_running`.
 * - Task has prior executions → resume the latest history (the Continue/Retry
 *   button — `continueLatestPtyExecution`), returns `continued`.
 * - No history → fresh start with task context (the Launch button), returns `started`.
 *
 * Used by the `resume_task_execution` MCP tool so a related task can bring up a
 * sibling's terminal before sending it a message.
 */
export async function continueOrStartTaskExecution(
  taskId: string
): Promise<{
  mode: "already_running" | "continued" | "started";
  executionId: string | null;
  worktreePath: string | null;
  connectionId: string | null;
  modelId: string | null;
  targetId: string | null;
}> {
  // Already running? Respect the one-active-PTY-per-task constraint — don't restart.
  const { getSession } = await import("@/lib/pty/session-store");
  const session = getSession(taskId);
  if (session && !session.killed) {
    const exec = await db.taskExecution.findFirst({
      where: { taskId, status: "RUNNING" },
      orderBy: { createdAt: "desc" },
    });
    return {
      mode: "already_running",
      executionId: exec?.id ?? null,
      worktreePath: exec?.worktreePath ?? null,
      connectionId: exec?.connectionId ?? null,
      modelId: exec?.modelId ?? null,
      targetId: exec?.targetId ?? null,
    };
  }

  // Has history → resume latest (Continue/Retry). Otherwise fresh start (Launch).
  const historyCount = await db.taskExecution.count({ where: { taskId } });
  if (historyCount > 0) {
    const r = await continueLatestPtyExecution(taskId);
    return { mode: "continued", ...r };
  }

  // Fresh start mirrors the Launch button: empty prompt, task context injected.
  const r = await startPtyExecution(taskId, "");
  return { mode: "started", ...r };
}

/**
 * INT-01: Create a TaskExecution row and spawn the selected CLI in PTY mode.
 *
 * This replaces the SSE stream route for terminal-based execution (Phase 26).
 * The session is pre-created with a no-op onData; ws-server.ts wires the real
 * WebSocket broadcaster when the client connects (via setDataListener).
 *
 * Differences from stream route:
 * - No --output-format stream-json or --print - flags (INT-02: raw TTY mode)
 * - Status update happens in the PTY onExit callback (INT-03)
 * - revalidatePath called after status transition to IN_PROGRESS
 */
export async function startPtyExecution(
  taskId: string,
  prompt: string,
  selectedPromptId?: string | null,
  callbackUrl?: string | null,
  /** When true, skip injecting task context — start a clean CLI session */
  cleanStart?: boolean,
  /** Internal resume/continue retry: keep the exact historical target snapshot. */
  fixedTargetSnapshot?: TerminalTargetSnapshot,
): Promise<TerminalExecutionResult> {
  // Harness cleanup: fresh/restarted execution → cancel the old pending ask (a fresh start via /reply has no
  // history, so there's no OPEN ask to clear here either). best-effort.
  await cancelOpenAsks(taskId).catch(() => {});
  // 1. Load task with project; labels decide which system directive applies
  // (see step 7c) and which branch prefix the worktree gets (step 6). Ordered
  // by name so "first label with a prefix wins" is stable and predictable —
  // relation rows come back in no guaranteed order otherwise.
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      project: true,
      labels: { include: { label: true }, orderBy: { label: { name: "asc" } } },
    },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  if (!task.project?.localPath) {
    throw new Error("Project has no local path configured");
  }
  if (task.project.accessMode === "REVIEW_ONLY") {
    throw new Error(
      "REVIEW_ONLY projects cannot start terminal execution. The owner must explicitly change the project to FULL_WORK first.",
    );
  }

  // 1a. Enforce concurrency limit
  const maxConcurrent = await readConfigValue<number>("system.maxConcurrentExecutions", 20);
  const runningCount = await db.taskExecution.count({ where: { status: "RUNNING" } });
  if (runningCount >= maxConcurrent) {
    throw new Error(`已达并发上限（${maxConcurrent}），请等待其他任务完成后再启动`);
  }

  // 1b. Read idle timeout from config
  const idleTimeoutSec = await readConfigValue<number>("terminal.idleTimeoutSec", 180);

  // 2. Clean up stale RUNNING executions (from crashed/killed processes)
  await db.taskExecution.updateMany({
    where: { taskId, status: "RUNNING" },
    data: { status: "FAILED", endedAt: new Date() },
  });

  // 3. Build full prompt string (mirrors stream/route.ts buildExecutionPrompt)
  // When cleanStart is true, skip all context — user wants a pure CLI terminal.
  let fullPrompt = "";
  if (!cleanStart) {
    const messages = await db.taskMessage.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const contextParts = [
      `Task: ${task.title}`,
      task.description ? `Description: ${task.description}` : "",
      messages.length > 0
        ? `Recent conversation:\n${messages
            .reverse()
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n")}`
        : "",
      prompt.trim() ? `User message: ${prompt}` : "",
    ].filter(Boolean);
    fullPrompt = contextParts.join("\n\n");
  }

  // 4. Prepare instructions file if task has a promptId (or selectedPromptId)
  let instructionsFile: string | undefined;
  let tempDir: string | undefined;
  let resolvedWorktreePath: string | null = null;
  let resolvedWorktreeBranch: string | null = null;
  let execution: { id: string };

  try {
    const promptId = selectedPromptId ?? task.promptId;
    if (promptId) {
      const promptRecord = await db.agentPrompt.findUnique({
        where: { id: promptId },
      });
      if (promptRecord?.content) {
        tempDir = await mkdtemp(join(tmpdir(), "tower-pty-"));
        instructionsFile = join(tempDir, "instructions.md");
        await writeFile(instructionsFile, promptRecord.content, "utf-8");
      }
    }

    // 5. Create worktree if task has a baseBranch
    if (task.baseBranch && task.project.localPath) {
      // The task's labels decide the branch prefix; no prefixed label falls back
      // to the configured default, whose "task" value keeps the historical
      // `task/<taskId>`. The resolved name is persisted on the execution below —
      // teardown reads it back instead of re-deriving it.
      const defaultPrefix = await readConfigValue<string>(
        "git.defaultWorktreeBranchPrefix",
        DEFAULT_BRANCH_PREFIX
      );
      const { worktreePath, worktreeBranch } = await createWorktree(
        task.project.localPath,
        taskId,
        task.baseBranch,
        resolveWorktreeBranch(
          task.labels.map((tl) => tl.label),
          defaultPrefix,
          taskId
        )
      );
      resolvedWorktreePath = worktreePath;
      resolvedWorktreeBranch = worktreeBranch;
    }

    // 6. Create one pending execution before resolving or trying any target.
    execution = await db.taskExecution.create({
      data: {
        taskId,
        status: "PENDING",
        startedAt: new Date(),
        worktreePath: resolvedWorktreePath ?? null,
        worktreeBranch: resolvedWorktreeBranch ?? null,
        callbackUrl: callbackUrl ?? null,
      },
    });
  } catch (error) {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }

  const baseCwd = resolvedWorktreePath ?? task.project.localPath;
  const cwd = task.subPath ? join(baseCwd, task.subPath) : baseCwd;

  const previousTaskStatus = task.status;
  let selected: { launch: TerminalLaunch; target: ResolvedCapabilityTarget; snapshot: TerminalTargetSnapshot };
  try {
    if (task.status !== "IN_PROGRESS") {
      await db.task.update({
        where: { id: taskId },
        data: { status: "IN_PROGRESS" },
      });
      refreshWorkspaces();
    }

    // Reconcile real CLI config immediately before every PTY spawn. This also
    // lets a restored CLI recover an unavailable cached connection.
    let terminalReconciliationFailures: Map<
      string,
      { code: ReturnType<typeof capabilityError>["code"]; message: string }
    > | null = null;
    if (fixedTargetSnapshot) {
      await reconcileTerminalExecutionBinding({
        connectionId: fixedTargetSnapshot.connectionId,
        agent: "",
      }, cwd);
    } else {
      terminalReconciliationFailures = await reconcileTerminalCapabilityTargets(cwd);
    }

    // Resolve only after the final cwd is known. A fixed retry never reads the slot.
    const terminalTargets = fixedTargetSnapshot
      ? [await resolveFixedCliConnection(
          fixedTargetSnapshot.connectionId,
          fixedTargetSnapshot.modelId,
          { cwd, targetId: fixedTargetSnapshot.targetId },
        )]
      : (await resolveTerminalTargetPlan({ cwd })).targets.map((target) => {
          const reconciliationFailure = terminalReconciliationFailures?.get(target.connectionId);
          return reconciliationFailure
            ? { ...target, preflightError: reconciliationFailure }
            : target;
        });

    // 6b. Record forkCommit
    // Worktree mode: merge-base between baseBranch and HEAD
    // Direct mode: current HEAD commit (baseline for diff)
    // Captured into an outer variable so the onExit summary can scope the git
    // range to THIS task's own commits (prevents summary cross-talk in direct mode).
    let resolvedForkCommit: string | null = null;
    if (task.project.localPath) {
      try {
        const { execFileSync } = await import("child_process");
        let forkCommit: string;
        if (resolvedWorktreePath && task.baseBranch) {
          forkCommit = execFileSync(
            "git", ["merge-base", task.baseBranch, "HEAD"],
            { cwd: resolvedWorktreePath, encoding: "utf-8", timeout: 5000 }
          ).trim();
        } else {
          forkCommit = execFileSync(
            "git", ["rev-parse", "HEAD"],
            { cwd: task.project.localPath, encoding: "utf-8", timeout: 5000 }
          ).trim();
        }
        if (forkCommit) {
          resolvedForkCommit = forkCommit;
          await db.taskExecution.update({
            where: { id: execution.id },
            data: { forkCommit },
          });
        }
      } catch {
        // Best effort — diff will fallback to branch comparison
      }
    }

    // 6c. Build system prompt additions
    // Built-in system directive first (attached to every task; default in config-defaults.ts, overridable via SystemConfig),
    // then merge the task's chosen AgentPrompt (after), and finally append the username.
    // Workbench tasks (builtin "Tower" label) get their own directive instead — they dispatch
    // and review work rather than doing it. Either/or, never both.
    let appendSystemPrompt = "";
    const { CONFIG_DEFAULTS } = await import("@/lib/config-defaults");
    const isWorkbench = task.labels.some(
      (tl) => tl.label.name === TOWER_LABEL_NAME && tl.label.isBuiltin
    );
    const directiveKey = isWorkbench ? "task.workbenchDirective" : "task.systemDirective";
    const systemDirective = await readConfigValue<string>(
      directiveKey,
      CONFIG_DEFAULTS[directiveKey].defaultValue as string
    );
    if (systemDirective) {
      appendSystemPrompt += systemDirective;
    }
    if (instructionsFile) {
      const { readFile } = await import("fs/promises");
      const selectedInstructions = await readFile(instructionsFile, "utf-8");
      appendSystemPrompt += (appendSystemPrompt ? "\n\n" : "") + selectedInstructions;
    }
    const usernameVal = await readConfigValue<string>("onboarding.username", "");
    if (usernameVal) {
      appendSystemPrompt += (appendSystemPrompt ? "\n" : "") + `The user's name is ${usernameVal}.`;
    }

    // Build and synchronously spawn each explicit target in order. Returning from
    // createSession is the activity boundary: later process exits never fall back.
    selected = await executeTerminalPrestartFallback({
      requestId: randomUUID(),
      correlationId: execution.id,
      targets: terminalTargets,
      onAttempt: recordCapabilityAttemptService,
      execute: async (target, context) => {
        let launch: TerminalLaunch;
        try {
          launch = await buildTerminalLaunch(target, {
            prompt: fullPrompt,
            cwd,
            mode: { type: "fresh" },
            systemPrompt: appendSystemPrompt || undefined,
            model: target.modelId,
            envPatch: taskEnvironment({
              taskId,
              taskTitle: task.title,
              callbackUrl: callbackUrl ?? undefined,
              hasParent: !!task.parentTaskId,
              executionId: execution.id,
            }),
          });
        } catch (error) {
          throw normalizeCapabilityError(error);
        }

        const snapshot = terminalTargetSnapshot(target);
        await db.taskExecution.update({
          where: { id: execution.id },
          data: {
            status: "RUNNING",
            endedAt: null,
            agent: target.cli!.provider.agentFieldValue,
            ...snapshot,
          },
        });

        try {
          createSession(
            taskId,
            launch.processSpec.command,
            launch.processSpec.args,
            cwd,
            () => {},
            async (exitCode) => {
              await writeExitSignal(taskId, exitCode);

              const currentExec = await db.taskExecution.findUnique({ where: { id: execution.id } });
              if (currentExec?.status !== "RUNNING") return;

              const { getSession } = await import("@/lib/pty/session-store");
              const session = getSession(taskId);
              const terminalBuffer = session?.getBuffer() ?? "";

              await db.taskExecution.update({
                where: { id: execution.id },
                data: {
                  status: exitCode === 0 ? "COMPLETED" : "FAILED",
                  endedAt: new Date(),
                },
              }).catch((err: unknown) => {
                log.error("Failed to update execution status", err);
              });

              const summaryPath = resolvedWorktreePath || task.project!.localPath;
              const { captureExecutionSummary } = await import("@/lib/execution-summary");
              await captureExecutionSummary(
                execution.id,
                taskId,
                exitCode,
                terminalBuffer,
                summaryPath,
                resolvedForkCommit,
              );

              const { dispatchTaskCompletionEvent } = await import("@/actions/onboarding-actions");
              await dispatchTaskCompletionEvent({
                taskId,
                taskTitle: task.title,
                status: exitCode === 0 ? "COMPLETED" : "FAILED",
                executionId: execution.id,
                workspaceId: task.project.workspaceId,
              });

              if (exitCode === 0) {
                await db.task.update({
                  where: { id: taskId },
                  data: { status: "IN_REVIEW", unattended: false },
                }).catch((err: unknown) => {
                  log.error("Failed to update task status", err);
                });
              }

              if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});

              if (session && !session.disconnectTimer) {
                const { destroySession } = await import("@/lib/pty/session-store");
                const KEEPALIVE_EXITED_MS = 5 * 60 * 1000;
                const timer = setTimeout(() => destroySession(taskId), KEEPALIVE_EXITED_MS);
                timer.unref?.();
                session.disconnectTimer = timer;
              }
            },
            launch.envOverrides,
            undefined,
            idleTimeoutSec * 1000,
            launch.processSpec.initialInput,
            launch.baseEnv,
          );
        } catch {
          await db.taskExecution.updateMany({
            where: { id: execution.id, status: "RUNNING" },
            data: {
              status: "PENDING",
              endedAt: null,
              connectionId: null,
              modelId: null,
              targetId: null,
            },
          }).catch(() => {});
          throw capabilityError("spawn_failed");
        }

        context.onActivity("side_effect");
        return { launch, target, snapshot };
      },
    });
  } catch (error) {
    await failTerminalPrestart({
      executionId: execution.id,
      taskId,
      previousTaskStatus,
      tempDir,
      clearTargetSnapshot: true,
    });
    throw error;
  }

  return {
    executionId: execution.id,
    worktreePath: resolvedWorktreePath ?? baseCwd ?? null,
    ...selected.snapshot,
  };
}

export interface StartPtyResult {
  ok: boolean;
  executionId?: string;
  worktreePath?: string | null;
  connectionId?: string;
  modelId?: string | null;
  targetId?: string;
  error?: string;
}

/**
 * UI-facing wrapper around {@link startPtyExecution}.
 *
 * Server Actions that throw have their error message redacted by the React
 * RSC layer in production (the generic "An error occurred in the Server
 * Components render" message). UI callers cannot recover the real cause from
 * a thrown error, so this wrapper catches the failure, logs the full detail
 * on the server, and returns a structured envelope whose `error` string is
 * safe to surface to the user.
 */
export async function startPtyExecutionSafe(
  taskId: string,
  prompt: string,
  selectedPromptId?: string | null,
  callbackUrl?: string | null,
  cleanStart?: boolean
): Promise<StartPtyResult> {
  try {
    const result = await startPtyExecution(taskId, prompt, selectedPromptId, callbackUrl, cleanStart);
    return { ok: true, ...result };
  } catch (err) {
    log.error("startPtyExecution failed", { taskId, error: err instanceof Error ? err.stack ?? err.message : String(err) });
    const message = err instanceof Error && err.message ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function getActiveExecutionsAcrossWorkspaces(): Promise<ActiveExecutionInfo[]> {
  const executions = await db.taskExecution.findMany({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "asc" },
    include: {
      task: {
        include: {
          project: {
            include: { workspace: true },
          },
          labels: { include: { label: true } },
          workbenchRuntime: true,
        },
      },
    },
  });
  return executions.map((e) => ({
    executionId: e.id,
    taskId: e.taskId,
    taskTitle: e.task.title,
    projectId: e.task.project.id,
    projectName: e.task.project.name,
    projectAlias: e.task.project.alias,
    projectLocalPath: e.task.project.localPath,
    workspaceId: e.task.project.workspace.id,
    workspaceName: e.task.project.workspace.name,
    worktreePath: e.worktreePath,
    subPath: e.task.subPath ?? null,
    startedAt: e.startedAt?.toISOString() ?? null,
    // Builtin "Tower" label marks system/workbench tasks (same check the MCP report tools use).
    isSystemTask: e.task.labels.some((tl) => tl.label.name === "Tower" && tl.label.isBuiltin),
    workbenchRuntime: e.task.workbenchRuntime
      ? {
          generation: e.task.workbenchRuntime.generation,
          state: e.task.workbenchRuntime.state,
          activeBatchId: e.task.workbenchRuntime.activeBatchId,
          pendingEvents: e.task.workbenchRuntime.pendingEvents,
          lastHeartbeatAt: e.task.workbenchRuntime.lastHeartbeatAt.toISOString(),
          blockedReason: e.task.workbenchRuntime.blockedReason,
          lastError: e.task.workbenchRuntime.lastError,
        }
      : null,
  }));
}
