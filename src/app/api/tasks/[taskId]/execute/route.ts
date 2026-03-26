import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { canStartExecution } from "@/lib/adapters/process-manager";
import { listAdapters } from "@/lib/adapters/registry";

const bodySchema = z.object({
  agent: z.string().optional(),
  config: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { agent, config } = parsed.data;

    const task = await db.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!task.project?.localPath) {
      return NextResponse.json(
        { error: "Project has no local path configured" },
        { status: 400 }
      );
    }

    // Check no RUNNING execution for this task
    const runningExecution = await db.taskExecution.findFirst({
      where: { taskId, status: "RUNNING" },
    });
    if (runningExecution) {
      return NextResponse.json(
        { error: "Task already has a running execution" },
        { status: 409 }
      );
    }

    // Check concurrent limit
    if (!canStartExecution()) {
      return NextResponse.json(
        { error: "Max concurrent executions reached" },
        { status: 503 }
      );
    }

    const execution = await db.taskExecution.create({
      data: {
        taskId,
        agent: agent ?? "CLAUDE_CODE",
        config: config ?? "DEFAULT",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    await db.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS" },
    });

    return NextResponse.json(execution);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to start execution" },
      { status: 500 }
    );
  }
}
