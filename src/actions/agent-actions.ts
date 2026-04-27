"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createWorktree } from "@/lib/worktree";
import { createSession } from "@/lib/pty/session-store";
import { logger } from "@/lib/logger";
import { readConfigValue } from "@/lib/config-reader";
import { resolveCliAdapter } from "@/lib/ai/capability-resolver";
import { writeFile, rm, mkdtemp, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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
  startedAt: string | null; // ISO string for serialization
}

const log = logger.create("agent-actions");

const SIGNAL_DIR = join(tmpdir(), "tower-signals");

async function writeExitSignal(taskId: string, exitCode: number): Promise<void> {
  try {
    await mkdir(SIGNAL_DIR, { recursive: true, mode: 0o700 });
    await writeFile(join(SIGNAL_DIR, `exit-${taskId}`), String(exitCode), { mode: 0o600 });
  } catch {
    // Best-effort — notification degraded, not fatal
  }
}

function parseProfileJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`CLI Profile ${label} 格式损坏，请在 Settings 中修复`);
  }
}

export async function sendTaskMessage(taskId: string, content: string) {
  const userMessage = await db.taskMessage.create({
    data: {
      role: "USER",
      content,
      taskId,
    },
  });

  revalidatePath("/workspaces");
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

  revalidatePath("/workspaces");
  return execution;
}

export async function stopTaskExecution(executionId: string, status: "COMPLETED" | "FAILED" = "FAILED") {
  const execution = await db.taskExecution.update({
    where: { id: executionId },
    data: { status, endedAt: new Date() },
  });
  revalidatePath("/workspaces");
  return execution;
}

/**
 * Stop a running PTY session for a task. Kills the process, captures summary,
 * and updates the execution status to COMPLETED.
 */
export async function stopPtyExecution(taskId: string): Promise<void> {
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

    // Transition task to IN_REVIEW
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_REVIEW" },
    });

    // Capture summary — use worktreePath or project localPath for direct mode
    const summaryPath = execution.worktreePath || task?.project?.localPath || null;
    const { captureExecutionSummary } = await import("@/lib/execution-summary");
    await captureExecutionSummary(
      execution.id, taskId, 0, terminalBuffer, summaryPath
    );
  }

  revalidatePath("/workspaces");
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
 * Resume a previous Claude CLI session for a task.
 * Reuses the existing TaskExecution record (same session = same execution).
 */
export async function resumePtyExecution(
  taskId: string,
  previousSessionId: string
): Promise<{ executionId: string; worktreePath: string | null }> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) throw new Error("Task not found");
  if (!task.project?.localPath) throw new Error("Project has no local path configured");

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

  // Read CliProfile — determines profile args and env vars
  const profile = await db.cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) throw new Error("No default CLI profile found — run seed first");
  const profileBaseArgs = parseProfileJson<string[]>(profile.baseArgs, "baseArgs");
  const profileEnvVars = parseProfileJson<Record<string, string>>(profile.envVars, "envVars");

  // Read idle timeout from config
  const idleTimeoutSec = await readConfigValue<number>("terminal.idleTimeoutSec", 180);

  // Resolve adapter
  const { adapter: cliAdapter } = await resolveCliAdapter("terminal");

  const adapterEnv = cliAdapter.buildEnvOverrides({
    taskId,
    taskTitle: task.title,
    apiUrl: `http://localhost:${process.env.PORT || "3000"}`,
    callbackUrl: prevExec.callbackUrl ?? undefined,
  });

  // Reuse execution: set back to RUNNING
  const execution = await db.taskExecution.update({
    where: { id: prevExec.id },
    data: { status: "RUNNING", endedAt: null },
  });

  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath("/workspaces");

  const usernameVal = await readConfigValue<string>("onboarding.username", "");

  const spawnResult = cliAdapter.buildSpawnArgs({
    taskId,
    prompt: "",
    cwd,
    resumeSessionId: previousSessionId,
    profileArgs: [
      ...profileBaseArgs,
      ...(usernameVal ? ["--append-system-prompt", `The user's name is ${usernameVal}.`] : []),
    ],
    profileEnvVars,
    envOverrides: adapterEnv,
  });

  const SESSION_ERROR_RE = /no conversation found with session id|unknown session|session .* not found/i;

  createSession(
    taskId,
    spawnResult.command,
    spawnResult.args,
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

      // Session resume fallback: if Claude exited with session error, auto-retry fresh
      if (exitCode !== 0 && SESSION_ERROR_RE.test(terminalBuffer)) {
        log.info("Session resume failed — retrying with fresh execution", { taskId, previousSessionId });
        await db.taskExecution.update({
          where: { id: execution.id },
          data: { status: "FAILED", endedAt: new Date() },
        }).catch(() => {});
        try {
          await startPtyExecution(taskId, task.title);
        } catch (err) {
          log.error("Fresh execution retry also failed", err, { taskId });
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
      await captureExecutionSummary(execution.id, taskId, exitCode, terminalBuffer, summaryPath);

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
        await db.task.update({ where: { id: taskId }, data: { status: "IN_REVIEW" } }).catch(() => {});
      }
    },
    spawnResult.env,
    undefined,
    idleTimeoutSec * 1000
  );

  return { executionId: execution.id, worktreePath: prevExec.worktreePath ?? baseCwd ?? null };
}

/**
 * Continue the most recent Claude CLI session for a task (no sessionId needed).
 * Uses `claude --continue` to resume the latest conversation in the cwd.
 * Useful when a session was interrupted (crash, power loss) and sessionId was not captured.
 */
export async function continueLatestPtyExecution(
  taskId: string
): Promise<{ executionId: string; worktreePath: string | null }> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) throw new Error("Task not found");
  if (!task.project?.localPath) throw new Error("Project has no local path configured");

  // Find the latest execution to reuse its worktree path
  const latestExec = await db.taskExecution.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });

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

  // Read CliProfile
  const profile = await db.cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) throw new Error("No default CLI profile found — run seed first");
  const profileBaseArgs = parseProfileJson<string[]>(profile.baseArgs, "baseArgs");
  const profileEnvVars = parseProfileJson<Record<string, string>>(profile.envVars, "envVars");
  const idleTimeoutSec = await readConfigValue<number>("terminal.idleTimeoutSec", 180);

  // Resolve adapter
  const { adapter: cliAdapter, provider: providerDef } = await resolveCliAdapter("terminal");

  const adapterEnv = cliAdapter.buildEnvOverrides({
    taskId,
    taskTitle: task.title,
    apiUrl: `http://localhost:${process.env.PORT || "3000"}`,
  });

  // Create a new execution record
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent: providerDef.agentFieldValue,
      status: "RUNNING",
      startedAt: new Date(),
      worktreePath: latestExec?.worktreePath ?? null,
      worktreeBranch: latestExec?.worktreeBranch ?? null,
    },
  });

  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath("/workspaces");

  const usernameVal = await readConfigValue<string>("onboarding.username", "");

  const spawnResult = cliAdapter.buildSpawnArgs({
    taskId,
    prompt: "",
    cwd,
    continueLatest: true,
    profileArgs: [
      ...profileBaseArgs,
      ...(usernameVal ? ["--append-system-prompt", `The user's name is ${usernameVal}.`] : []),
    ],
    profileEnvVars,
    envOverrides: adapterEnv,
  });

  createSession(
    taskId,
    spawnResult.command,
    spawnResult.args,
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
      }).catch(() => {});

      const summaryPath = latestExec?.worktreePath || task.project!.localPath;
      const { captureExecutionSummary } = await import("@/lib/execution-summary");
      await captureExecutionSummary(execution.id, taskId, exitCode, terminalBuffer, summaryPath);

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
        await db.task.update({ where: { id: taskId }, data: { status: "IN_REVIEW" } }).catch(() => {});
      }
    },
    spawnResult.env,
    undefined,
    idleTimeoutSec * 1000
  );

  return { executionId: execution.id, worktreePath: latestExec?.worktreePath ?? baseCwd ?? null };
}

/**
 * INT-01: Create a TaskExecution row and spawn Claude CLI in PTY mode.
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
  callbackUrl?: string | null
): Promise<{ executionId: string; worktreePath: string | null }> {
  // 1. Load task with project
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  if (!task.project?.localPath) {
    throw new Error("Project has no local path configured");
  }

  // 1a. Enforce concurrency limit
  const maxConcurrent = await readConfigValue<number>("system.maxConcurrentExecutions", 20);
  const runningCount = await db.taskExecution.count({ where: { status: "RUNNING" } });
  if (runningCount >= maxConcurrent) {
    throw new Error(`已达并发上限（${maxConcurrent}），请等待其他任务完成后再启动`);
  }

  // 1b. Read CliProfile — determines profile args and env vars
  const profile = await db.cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) throw new Error("No default CLI profile found — run seed first");
  const profileBaseArgs = parseProfileJson<string[]>(profile.baseArgs, "baseArgs");
  const profileEnvVars = parseProfileJson<Record<string, string>>(profile.envVars, "envVars");

  // 1c. Read idle timeout from config
  const idleTimeoutSec = await readConfigValue<number>("terminal.idleTimeoutSec", 180);

  // 1d. Resolve adapter
  const { adapter: cliAdapter, provider: providerDef, model: configuredModel } = await resolveCliAdapter("terminal");

  // 2. Clean up stale RUNNING executions (from crashed/killed processes)
  await db.taskExecution.updateMany({
    where: { taskId, status: "RUNNING" },
    data: { status: "FAILED", endedAt: new Date() },
  });

  // 3. Transition task to IN_PROGRESS (from TODO, IN_REVIEW, or any non-terminal state)
  if (task.status !== "IN_PROGRESS") {
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS" },
    });
    revalidatePath("/workspaces");
  }

  // 4. Build full prompt string (mirrors stream/route.ts buildExecutionPrompt)
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
  const fullPrompt = contextParts.join("\n\n");

  // 5. Prepare instructions file if task has a promptId (or selectedPromptId)
  let instructionsFile: string | undefined;
  let tempDir: string | undefined;

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

  // 6. Create worktree if task has a baseBranch
  let resolvedWorktreePath: string | null = null;
  let resolvedWorktreeBranch: string | null = null;

  if (task.baseBranch && task.project.localPath) {
    const { worktreePath, worktreeBranch } = await createWorktree(
      task.project.localPath,
      taskId,
      task.baseBranch
    );
    resolvedWorktreePath = worktreePath;
    resolvedWorktreeBranch = worktreeBranch;
  }

  const baseCwd = resolvedWorktreePath ?? task.project.localPath;
  const cwd = task.subPath ? join(baseCwd, task.subPath) : baseCwd;

  // 7. Create TaskExecution row with RUNNING status
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent: providerDef.agentFieldValue,
      status: "RUNNING",
      startedAt: new Date(),
      worktreePath: resolvedWorktreePath ?? null,
      worktreeBranch: resolvedWorktreeBranch ?? null,
      callbackUrl: callbackUrl ?? null,
    },
  });

  // 7b. Record forkCommit
  // Worktree mode: merge-base between baseBranch and HEAD
  // Direct mode: current HEAD commit (baseline for diff)
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
        await db.taskExecution.update({
          where: { id: execution.id },
          data: { forkCommit },
        });
      }
    } catch {
      // Best effort — diff will fallback to branch comparison
    }
  }

  // 7c. Build system prompt additions
  let appendSystemPrompt = "";
  if (instructionsFile) {
    const { readFile } = await import("fs/promises");
    appendSystemPrompt += await readFile(instructionsFile, "utf-8");
  }
  const usernameVal = await readConfigValue<string>("onboarding.username", "");
  if (usernameVal) {
    appendSystemPrompt += (appendSystemPrompt ? "\n" : "") + `The user's name is ${usernameVal}.`;
  }

  // 8. Adapter produces complete command + args + env
  const spawnResult = cliAdapter.buildSpawnArgs({
    taskId,
    prompt: fullPrompt,
    cwd,
    profileArgs: [
      ...profileBaseArgs,
      ...(appendSystemPrompt ? ["--append-system-prompt", appendSystemPrompt] : []),
      ...(configuredModel ? ["--model", configuredModel] : []),
    ],
    profileEnvVars,
    envOverrides: cliAdapter.buildEnvOverrides({
      taskId,
      taskTitle: task.title,
      apiUrl: `http://localhost:${process.env.PORT || "3000"}`,
      callbackUrl: callbackUrl ?? undefined,
    }),
  });

  // 9. Create PTY session — onData is a no-op; ws-server.ts wires the real
  //    broadcaster via setDataListener when the WebSocket client connects
  createSession(
    taskId,
    spawnResult.command,
    spawnResult.args,
    cwd,
    () => {},
    async (exitCode) => {
      // Write exit code signal file for notify-agi.sh (runs before DB update)
      await writeExitSignal(taskId, exitCode);

      // Guard: if stopPtyExecution already handled this execution, skip
      const currentExec = await db.taskExecution.findUnique({ where: { id: execution.id } });
      if (currentExec?.status !== "RUNNING") {
        // Already finalized by stopPtyExecution — don't overwrite
        return;
      }

      // Capture terminal buffer FIRST (before session might be destroyed)
      const { getSession } = await import("@/lib/pty/session-store");
      const session = getSession(taskId);
      const terminalBuffer = session?.getBuffer() ?? "";

      // INT-03: Update execution status and task status on PTY exit
      await db.taskExecution
        .update({
          where: { id: execution.id },
          data: {
            status: exitCode === 0 ? "COMPLETED" : "FAILED",
            endedAt: new Date(),
          },
        })
        .catch((err: unknown) => {
          log.error("Failed to update execution status", err);
        });

      // Capture execution summary (git log, stats, terminal log)
      // Use worktreePath if available, otherwise fall back to project localPath (direct mode)
      const summaryPath = resolvedWorktreePath || task.project!.localPath;
      const { captureExecutionSummary } = await import("@/lib/execution-summary");
      await captureExecutionSummary(
        execution.id,
        taskId,
        exitCode,
        terminalBuffer,
        summaryPath
      );

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
        await db.task
          .update({ where: { id: taskId }, data: { status: "IN_REVIEW" } })
          .catch((err: unknown) => {
            log.error("Failed to update task status", err);
          });
      }

      // Clean up temp instructions dir
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    spawnResult.env,
    undefined,
    idleTimeoutSec * 1000
  );

  return { executionId: execution.id, worktreePath: resolvedWorktreePath ?? baseCwd ?? null };
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
    startedAt: e.startedAt?.toISOString() ?? null,
  }));
}
