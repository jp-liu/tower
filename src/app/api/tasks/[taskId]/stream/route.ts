import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/adapters/registry";
import { canStartExecution, killProcess, registerProcess } from "@/lib/adapters/process-manager";
import { getConfigValue } from "@/actions/config-actions";
import { createWorktree } from "@/lib/worktree";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// --- Helper: validate request body, load task+project, check guards ---

type TaskWithProject = NonNullable<Awaited<ReturnType<typeof db.task.findUnique>>> & {
  project: { id: string; name: string; type: string; localPath: string | null } | null;
};

async function validateAndParseRequest(
  request: NextRequest,
  taskId: string
): Promise<
  | { prompt: string; agent: string | undefined; model: string | undefined; task: TaskWithProject }
  | Response
> {
  const body = await request.json();
  const bodySchema = z.object({
    prompt: z.string().min(1),
    agent: z.enum(["claude_local"]).optional(),
    model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional(),
  });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid request body", details: parsed.error.flatten() }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { prompt, agent, model } = parsed.data;

  // Read task + project from DB
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!task.project?.localPath) {
    return new Response(
      JSON.stringify({ error: "Project has no local path configured" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check no RUNNING execution
  const runningExecution = await db.taskExecution.findFirst({
    where: { taskId, status: "RUNNING" },
  });
  if (runningExecution) {
    return new Response(
      JSON.stringify({ error: "Task already has a running execution" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check concurrent limit
  if (!(await canStartExecution())) {
    return new Response(
      JSON.stringify({ error: "Max concurrent executions reached" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  return { prompt, agent, model, task };
}

// --- Helper: load recent messages and assemble full prompt string ---

async function buildExecutionPrompt(
  task: { title: string; description: string | null },
  prompt: string,
  taskId: string
): Promise<string> {
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
  return contextParts.join("\n\n");
}

// --- Helper: write instructions to a temp file if task has promptId ---

async function prepareInstructionsFile(
  task: { promptId: string | null }
): Promise<{ instructionsFile?: string; tempDir?: string }> {
  if (!task.promptId) {
    return {};
  }
  const promptRecord = await db.agentPrompt.findUnique({
    where: { id: task.promptId },
  });
  if (!promptRecord?.content) {
    return {};
  }
  const tempDir = await mkdtemp(join(tmpdir(), "ai-manager-"));
  const instructionsFile = join(tempDir, "instructions.md");
  await writeFile(instructionsFile, promptRecord.content, "utf-8");
  return { instructionsFile, tempDir };
}

// --- Helper: persist execution result and assistant message ---

async function persistResult(
  executionId: string,
  taskId: string,
  result: { exitCode: number | null; sessionId?: string | null; summary?: string | null },
  assistantContent: string
): Promise<void> {
  await db.taskExecution.update({
    where: { id: executionId },
    data: {
      status: result.exitCode === 0 ? "COMPLETED" : "FAILED",
      sessionId: result.sessionId ?? null,
      endedAt: new Date(),
    },
  });

  // Auto-transition to IN_REVIEW on successful execution (per D-15, D-16)
  if (result.exitCode === 0) {
    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_REVIEW" },
    });
  }

  const summaryContent = result.summary || assistantContent;
  if (summaryContent) {
    await db.taskMessage.create({
      data: {
        role: "ASSISTANT",
        content: summaryContent,
        taskId,
      },
    });
  }
}

// --- POST handler: thin orchestrator ---

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const validated = await validateAndParseRequest(request, taskId);
    if (validated instanceof Response) {
      return validated;
    }
    const { prompt, agent, model, task } = validated;

    // Send-back: if task is IN_REVIEW, transition to IN_PROGRESS (per D-12, D-13, D-14)
    if (task.status === "IN_REVIEW") {
      await db.task.update({
        where: { id: taskId },
        data: { status: "IN_PROGRESS" },
      });
    }

    // Find last session for resume
    const lastCompleted = await db.taskExecution.findFirst({
      where: { taskId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: { sessionId: true },
    });
    const resumeSessionId = lastCompleted?.sessionId ?? undefined;

    const fullPrompt = await buildExecutionPrompt(task, prompt, taskId);

    const { instructionsFile, tempDir } = await prepareInstructionsFile(task);

    // Create TaskExecution
    const execution = await db.taskExecution.create({
      data: {
        taskId,
        agent: agent ?? "CLAUDE_CODE",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    // Register process mapping for kill support
    registerProcess(execution.id, execution.id);

    // Create SSE ReadableStream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        let assistantContent = "";
        let lineBuf = "";

        // Parse stream-json lines and extract only meaningful content
        function processStreamChunk(rawChunk: string) {
          lineBuf += rawChunk;
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            const eventType = typeof event.type === "string" ? event.type : "";

            // Extract assistant text content and tool usage
            if (eventType === "assistant") {
              const message = event.message as Record<string, unknown> | undefined;
              const content = Array.isArray(message?.content) ? message.content : [];
              for (const block of content) {
                if (typeof block === "object" && block !== null && !Array.isArray(block)) {
                  const b = block as Record<string, unknown>;
                  if (b.type === "text" && typeof b.text === "string" && b.text) {
                    sendEvent({ type: "log", content: b.text });
                  }
                  // Extract tool use info (file edits, writes, bash commands etc)
                  if (b.type === "tool_use" && typeof b.name === "string") {
                    const input = b.input as Record<string, unknown> | undefined;
                    const toolName = b.name;
                    let toolInfo = "";
                    if (toolName === "Write" && input?.file_path) {
                      toolInfo = `📝 Write: ${input.file_path}`;
                    } else if (toolName === "Edit" && input?.file_path) {
                      toolInfo = `✏️ Edit: ${input.file_path}`;
                    } else if (toolName === "Read" && input?.file_path) {
                      toolInfo = `📖 Read: ${input.file_path}`;
                    } else if (toolName === "Bash" && input?.command) {
                      const cmd = String(input.command);
                      toolInfo = `$ ${cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd}`;
                    } else {
                      toolInfo = `🔧 ${toolName}`;
                    }
                    if (toolInfo) {
                      sendEvent({ type: "tool", content: toolInfo });
                    }
                  }
                }
              }
            }

            // Extract final result text
            if (eventType === "result") {
              const resultText = typeof event.result === "string" ? event.result : "";
              if (resultText) {
                sendEvent({ type: "result", content: resultText });
              }
            }
          }
        }

        // Determine cwd: worktree for GIT projects, localPath for NORMAL
        let cwd = task.project!.localPath!;

        if (task.project!.type === "GIT" && task.baseBranch) {
          try {
            const { worktreePath, worktreeBranch } = await createWorktree(
              task.project!.localPath!,
              taskId,
              task.baseBranch
            );
            // Persist worktree info on execution record
            await db.taskExecution.update({
              where: { id: execution.id },
              data: { worktreePath, worktreeBranch },
            });
            cwd = worktreePath;
            sendEvent({ type: "status", content: `Worktree ready: ${worktreeBranch}` });
          } catch (err) {
            // Per D-09: explicit failure, no silent fallback
            await db.taskExecution.update({
              where: { id: execution.id },
              data: { status: "FAILED", endedAt: new Date() },
            }).catch(() => {});
            sendEvent({
              type: "error",
              content: `Worktree creation failed: ${err instanceof Error ? err.message : String(err)}`,
            });
            controller.close();
            return;
          }
        }

        try {
          const adapter = getAdapter(agent ?? "claude_local");
          const timeoutSec = await getConfigValue<number>("git.timeoutSec", 30);

          sendEvent({ type: "status", content: "Agent started" });

          const result = await adapter.execute({
            runId: execution.id,
            prompt: fullPrompt,
            cwd,  // worktree path for GIT projects, localPath for NORMAL
            model,
            sessionId: resumeSessionId,
            instructionsFile,
            timeoutSec,
            onLog: async (logStream, chunk) => {
              assistantContent += chunk;
              if (logStream === "stdout") {
                processStreamChunk(chunk);
              }
            },
          });

          await persistResult(execution.id, taskId, result, assistantContent);

          // Emit status_changed SSE event for client refresh (per research Pitfall 3)
          if (result.exitCode === 0) {
            sendEvent({ type: "status_changed", status: "IN_REVIEW" });
          }

          if (result.errorMessage) {
            sendEvent({ type: "error", content: result.errorMessage });
          } else {
            sendEvent({ type: "status", content: "completed" });
          }
        } catch (error) {
          // Mark execution as failed
          await db.taskExecution
            .update({
              where: { id: execution.id },
              data: { status: "FAILED", endedAt: new Date() },
            })
            .catch(() => {});

          console.error("[stream] Execution error:", error);
          sendEvent({
            type: "error",
            content: "Agent execution failed",
          });
        } finally {
          // Clean up temp directory and file
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {});
          }
          controller.close();
        }
      },
    });

    // Listen to abort signal → kill process
    request.signal.addEventListener("abort", () => {
      killProcess(execution.id);
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Stream failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
