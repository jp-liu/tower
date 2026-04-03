"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createWorktree } from "@/lib/worktree";
import { createSession } from "@/lib/pty/session-store";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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

export async function getTaskExecutions(taskId: string) {
  return db.taskExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
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
 * - No revalidatePath — client calls router.refresh() after onSessionEnd (D-08)
 */
export async function startPtyExecution(
  taskId: string,
  prompt: string,
  selectedPromptId?: string | null
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

  // 2. Clean up stale RUNNING executions (from crashed/killed processes)
  await db.taskExecution.updateMany({
    where: { taskId, status: "RUNNING" },
    data: { status: "FAILED", endedAt: new Date() },
  });

  // 3. Send-back: if task is IN_REVIEW, transition back to IN_PROGRESS
  if (task.status === "IN_REVIEW") {
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS" },
    });
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
    `User message: ${prompt}`,
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
      tempDir = await mkdtemp(join(tmpdir(), "ai-manager-pty-"));
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

  const cwd = resolvedWorktreePath ?? task.project.localPath;

  // 7. Create TaskExecution row with RUNNING status
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent: "CLAUDE_CODE",
      status: "RUNNING",
      startedAt: new Date(),
      worktreePath: resolvedWorktreePath ?? null,
      worktreeBranch: resolvedWorktreeBranch ?? null,
    },
  });

  // 8. Build Claude CLI args — INT-02: no --output-format stream-json, no --print -
  const claudeArgs: string[] = ["--dangerously-skip-permissions"];
  if (instructionsFile) {
    claudeArgs.push("--system-prompt", instructionsFile);
  }
  claudeArgs.push(fullPrompt);

  // 9. Create PTY session — onData is a no-op; ws-server.ts wires the real
  //    broadcaster via setDataListener when the WebSocket client connects
  createSession(
    taskId,
    "claude",
    claudeArgs,
    cwd,
    () => {},
    async (exitCode) => {
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
          console.error("[startPtyExecution] Failed to update execution status:", err);
        });

      if (exitCode === 0) {
        await db.task
          .update({ where: { id: taskId }, data: { status: "IN_REVIEW" } })
          .catch((err: unknown) => {
            console.error("[startPtyExecution] Failed to update task status:", err);
          });
      }

      // Clean up temp instructions dir
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  );

  return { executionId: execution.id, worktreePath: resolvedWorktreePath };
}
