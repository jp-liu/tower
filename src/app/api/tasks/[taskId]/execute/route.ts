import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const body = await request.json();

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const execution = await db.taskExecution.create({
      data: {
        taskId,
        agent: body.agent ?? "CLAUDE_CODE",
        config: body.config ?? "DEFAULT",
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
