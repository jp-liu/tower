import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { execFileSync } from "child_process";
import { revalidatePath } from "next/cache";
import { checkConflicts } from "@/lib/diff-parser";
import { removeWorktree } from "@/lib/worktree";
import { mergeBranchIntoBase } from "@/lib/git-merge";

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

    // Merge the task branch into the base branch. The helper handles the
    // autostash dance: it preflights for index.lock / mid-merge / mid-rebase,
    // surfaces git's real stderr on a failed `git stash push`, only pops a
    // stash it actually created, and treats branch-restore/pop cleanup as
    // non-fatal — so a clean working tree no longer mis-reports as
    // "Merge failed".
    const { commitHash } = mergeBranchIntoBase({
      localPath,
      baseBranch: task.baseBranch,
      worktreeBranch,
    });

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

    // Update status to DONE — stamp doneAt as the archive-delay baseline
    // (same as updateTaskStatus; without it the task would archive immediately).
    await db.task.update({
      where: { id: parsed.data },
      data: { status: "DONE", doneAt: new Date() },
    });

    // Kill PTY first so the live process doesn't end up with a deleted cwd
    try {
      const { destroySession } = await import("@/lib/pty/session-store");
      destroySession(taskId);
    } catch (error) {
      console.error("[merge] PTY session destroy failed:", error);
    }

    // Generate the task change overview note BEFORE worktree cleanup, while the
    // diff/files are still resolvable. Only the git data-gathering is awaited;
    // the AI summary + note write run in the background. Never blocks merge.
    try {
      const { captureTaskOverview } = await import("@/lib/task-overview");
      await captureTaskOverview(taskId);
    } catch (error) {
      console.error("[merge] Task overview capture failed:", error);
    }

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
