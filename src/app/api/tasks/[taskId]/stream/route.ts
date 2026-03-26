import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/adapters/registry";
import { canStartExecution, killProcess, registerProcess } from "@/lib/adapters/process-manager";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const body = await request.json();
    const bodySchema = z.object({
      prompt: z.string().min(1),
      agent: z.string().optional(),
      model: z.string().optional(),
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
    if (!canStartExecution()) {
      return new Response(
        JSON.stringify({ error: "Max concurrent executions reached" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    // Find last session for resume
    const lastCompleted = await db.taskExecution.findFirst({
      where: { taskId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: { sessionId: true },
    });
    const resumeSessionId = lastCompleted?.sessionId ?? undefined;

    // Build prompt from task context + recent messages
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

    // If task has promptId, load prompt content and write to temp file
    let instructionsFile: string | undefined;
    let tempDir: string | undefined;
    if (task.promptId) {
      const promptRecord = await db.agentPrompt.findUnique({
        where: { id: task.promptId },
      });
      if (promptRecord?.content) {
        tempDir = await mkdtemp(join(tmpdir(), "ai-manager-"));
        instructionsFile = join(tempDir, "instructions.md");
        await writeFile(instructionsFile, promptRecord.content, "utf-8");
      }
    }

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

        try {
          const adapter = getAdapter(agent ?? "claude_local");

          sendEvent({ type: "status", content: "Agent started" });

          const result = await adapter.execute({
            runId: execution.id,
            prompt: fullPrompt,
            cwd: task.project!.localPath!,
            model,
            sessionId: resumeSessionId,
            instructionsFile,
            onLog: async (stream, chunk) => {
              assistantContent += chunk;
              sendEvent({ type: "log", stream, content: chunk });
            },
          });

          // On completion: update execution record
          await db.taskExecution.update({
            where: { id: execution.id },
            data: {
              status: result.exitCode === 0 ? "COMPLETED" : "FAILED",
              sessionId: result.sessionId ?? null,
              endedAt: new Date(),
            },
          });

          // Save assistant message to DB
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

          sendEvent({
            type: "error",
            content:
              error instanceof Error
                ? error.message
                : "Agent execution failed",
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
