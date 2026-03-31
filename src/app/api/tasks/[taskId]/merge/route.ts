import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { execFileSync } from "child_process";
import { revalidatePath } from "next/cache";
import { checkConflicts } from "@/lib/diff-parser";
import { removeWorktree } from "@/lib/worktree";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  // Validate taskId with Zod (per project convention)
  const parsed = z.string().cuid().safeParse(taskId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  }

  try {
    // Load task with project
    const task = await db.task.findUnique({
      where: { id: parsed.data },
      include: { project: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.status !== "IN_REVIEW") {
      return NextResponse.json(
        { error: "Task must be in IN_REVIEW status to merge" },
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

    // Get latest COMPLETED execution for worktreeBranch
    const latestExecution = await db.taskExecution.findFirst({
      where: { taskId: parsed.data, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });

    const worktreeBranch = latestExecution?.worktreeBranch ?? `task/${taskId}`;
    const localPath = task.project.localPath;

    // Pre-merge conflict check (per D-10)
    const { hasConflicts, conflictFiles } = checkConflicts(
      localPath,
      task.baseBranch,
      worktreeBranch
    );

    if (hasConflicts) {
      return NextResponse.json(
        { error: "Merge conflicts detected", conflictFiles },
        { status: 409 }
      );
    }

    // Squash merge (per D-09): run three commands sequentially in main repo
    execFileSync("git", ["checkout", task.baseBranch], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 10000,
    });
    execFileSync("git", ["merge", "--squash", worktreeBranch], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30000,
    });
    execFileSync("git", ["commit", "-m", `feat: ${task.title}`], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 10000,
    });

    // Update status to DONE (per D-11)
    await db.task.update({
      where: { id: parsed.data },
      data: { status: "DONE" },
    });

    // Best-effort worktree cleanup (D-05: failures don't block DONE transition)
    try {
      await removeWorktree(localPath, taskId);
    } catch (error) {
      console.error("[merge] Worktree cleanup failed:", error);
    }

    revalidatePath("/workspaces");

    return NextResponse.json({ success: true, message: "Squash merge completed" });
  } catch (error) {
    console.error("[merge] Merge failed:", error);
    return NextResponse.json(
      { error: "Merge failed" },
      { status: 500 }
    );
  }
}
