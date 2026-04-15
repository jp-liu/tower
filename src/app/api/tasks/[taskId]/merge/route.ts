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

    const gitOpts = { encoding: "utf-8" as const, timeout: 30000 };

    // Record the branch tip BEFORE merge — used for accurate post-merge diff
    let branchTipCommit: string | undefined;
    try {
      branchTipCommit = execFileSync(
        "git", ["rev-parse", worktreeBranch],
        { ...gitOpts, cwd: localPath }
      ).trim();
    } catch {
      // Best effort — diff will fallback gracefully
    }

    // Normal merge: checkout baseBranch, merge task branch
    // Preserves full commit history from the task branch

    // 1. Stash any uncommitted changes in main repo (safety)
    // Filter out untracked files (??) — git stash push doesn't handle them without -u
    const mainStatus = execFileSync(
      "git", ["status", "--porcelain"],
      { ...gitOpts, cwd: localPath }
    ).trim();
    const hadStash = mainStatus.split("\n").some(
      (line) => line.trim() !== "" && !line.startsWith("??")
    );
    if (hadStash) {
      execFileSync("git", ["stash", "push", "-m", "ai-manager-merge-temp"], { ...gitOpts, cwd: localPath });
    }

    let commitHash: string;
    try {
      // 2. Checkout baseBranch in main repo
      execFileSync("git", ["checkout", task.baseBranch], { ...gitOpts, cwd: localPath });

      // 3. Merge the task branch (normal merge, preserves commit history)
      execFileSync("git", ["merge", worktreeBranch, "--no-edit"], { ...gitOpts, cwd: localPath });

      // 4. Get the merge commit hash
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

    // Record mergeCommit and branchTipCommit on the execution
    if (latestExecution && commitHash) {
      try {
        await db.taskExecution.update({
          where: { id: latestExecution.id },
          data: {
            mergeCommit: commitHash,
            ...(branchTipCommit ? { branchTipCommit } : {}),
          },
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
    const message = error instanceof Error ? error.message : String(error);
    console.error("[merge] Merge failed:", message);
    return NextResponse.json(
      { error: `Merge failed: ${message}` },
      { status: 500 }
    );
  }
}
