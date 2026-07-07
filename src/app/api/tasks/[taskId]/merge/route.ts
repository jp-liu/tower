import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { updateTaskStatus } from "@/actions/task-actions";
import { MergeConflictError, WorktreeDirtyError } from "@/lib/task-completion";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const parsed = z.string().cuid().safeParse(taskId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  }

  try {
    const task = await db.task.findUnique({
      where: { id: parsed.data },
      include: { project: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    // Reject only terminal states. Completion runs through the unified flow
    // (which kills the PTY + refuses on a dirty worktree), so merging a still-
    // running task is safe — this lets Mission Control complete a RUNNING card
    // directly, and keeps the merge dialog's Cancel non-destructive.
    if (task.status === "DONE" || task.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Task is already completed or cancelled" },
        { status: 400 }
      );
    }
    if (!task.baseBranch) {
      return NextResponse.json(
        { error: "Task has no base branch configured" },
        { status: 400 }
      );
    }
    if (!task.project?.localPath) {
      return NextResponse.json(
        { error: "Project has no local path" },
        { status: 400 }
      );
    }

    // Delegate to the unified completion flow. updateTaskStatus(DONE) runs
    // completeWorktreeReturn (merge into base + worktree teardown) for worktree
    // tasks, then flips status — the same path MCP move_task takes. It throws on
    // conflict / dirty worktree, which we map to the codes the merge dialog UI
    // expects.
    await updateTaskStatus(taskId, "DONE");

    return NextResponse.json({ success: true, message: "Merge completed" });
  } catch (error) {
    if (error instanceof MergeConflictError) {
      return NextResponse.json(
        { error: "Merge conflicts detected", conflictFiles: error.conflictFiles },
        { status: 409 }
      );
    }
    if (error instanceof WorktreeDirtyError) {
      return NextResponse.json(
        { error: "Worktree has uncommitted changes", files: error.files },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[merge] Merge failed:", message);
    return NextResponse.json(
      { error: `Merge failed: ${message}` },
      { status: 500 }
    );
  }
}
