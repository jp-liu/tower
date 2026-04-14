import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { execFileSync } from "child_process";
import { revalidatePath } from "next/cache";
import { checkConflicts } from "@/lib/diff-parser";
import { removeWorktree } from "@/lib/worktree";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const body = await request.json().catch(() => ({})) as { commitMessage?: string };

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

    const gitOpts = { encoding: "utf-8" as const, timeout: 30000 };
    const commitMessage = body.commitMessage || `feat: ${task.title}`;

    // Proper squash merge: checkout baseBranch, merge --squash, commit
    // This does a three-way merge preserving baseBranch's new commits
    // We operate in the main repo (not worktree) to avoid corrupting worktree state

    // 1. Stash any uncommitted changes in main repo (safety)
    const mainStatus = execFileSync(
      "git", ["status", "--porcelain"],
      { ...gitOpts, cwd: localPath }
    ).trim();
    const hadStash = mainStatus.length > 0;
    if (hadStash) {
      execFileSync("git", ["stash", "push", "-m", "ai-manager-merge-temp"], { ...gitOpts, cwd: localPath });
    }

    let commitHash: string;
    try {
      // 2. Checkout baseBranch in main repo
      execFileSync("git", ["checkout", task.baseBranch], { ...gitOpts, cwd: localPath });

      // 3. Squash merge the task branch (three-way merge, keeps baseBranch changes)
      execFileSync("git", ["merge", "--squash", worktreeBranch], { ...gitOpts, cwd: localPath });

      // 4. Commit the squash result
      execFileSync("git", ["commit", "-m", commitMessage], { ...gitOpts, cwd: localPath });

      // 5. Get the commit hash
      commitHash = execFileSync(
        "git", ["rev-parse", "--short", "HEAD"],
        { ...gitOpts, cwd: localPath }
      ).trim();
    } finally {
      // Restore stash if we had one
      if (hadStash) {
        execFileSync("git", ["stash", "pop"], { ...gitOpts, cwd: localPath }).toString();
      }
    }

    // Record mergeCommit on the execution (commitHash is the squash commit just created)
    if (latestExecution && commitHash) {
      try {
        await db.taskExecution.update({
          where: { id: latestExecution.id },
          data: { mergeCommit: commitHash },
        });
      } catch {
        // Best effort — diff will fallback gracefully
      }
    }

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
