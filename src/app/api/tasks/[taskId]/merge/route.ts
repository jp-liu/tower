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

    const latestExecution = await db.taskExecution.findFirst({
      where: { taskId: parsed.data, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });

    const worktreeBranch = latestExecution?.worktreeBranch ?? `task/${taskId}`;
    const worktreePath = latestExecution?.worktreePath;
    const localPath = task.project.localPath;

    // Pre-merge conflict check
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

    const gitOpts = { encoding: "utf-8" as const, timeout: 10000 };
    const cwd = worktreePath ?? localPath;

    // Safe merge: use git plumbing commands to update baseBranch ref
    // without touching any working directory.
    //
    // 1. Get the tree of the task branch (what we want to merge)
    const taskTree = execFileSync(
      "git", ["rev-parse", `${worktreeBranch}^{tree}`],
      { ...gitOpts, cwd }
    ).trim();

    // 2. Get the current HEAD of baseBranch
    const baseHead = execFileSync(
      "git", ["rev-parse", task.baseBranch],
      { ...gitOpts, cwd }
    ).trim();

    // 3. Create a new squash commit on baseBranch with the task's tree
    const commitHash = execFileSync(
      "git", ["commit-tree", taskTree, "-p", baseHead, "-m", `feat: ${task.title}`],
      { ...gitOpts, cwd }
    ).trim();

    // 4. Update baseBranch ref to point to the new commit (no checkout needed)
    execFileSync(
      "git", ["update-ref", `refs/heads/${task.baseBranch}`, commitHash],
      { ...gitOpts, cwd }
    );

    // Update status to DONE
    await db.task.update({
      where: { id: parsed.data },
      data: { status: "DONE" },
    });

    // Best-effort worktree cleanup
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
