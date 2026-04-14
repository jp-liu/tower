import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { parseDiffOutput, checkConflicts } from "@/lib/diff-parser";

export async function GET(
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
    if (!task.project?.localPath) {
      return NextResponse.json(
        { error: "Project has no local path" },
        { status: 400 }
      );
    }

    const baseBranch = task.baseBranch || "main";

    const latestExecution = await db.taskExecution.findFirst({
      where: { taskId: parsed.data },
      orderBy: { createdAt: "desc" },
    });

    if (!latestExecution?.worktreeBranch) {
      return NextResponse.json({
        files: [], totalAdded: 0, totalRemoved: 0,
        hasConflicts: false, conflictFiles: [], commitCount: 0,
      });
    }

    const worktreeBranch = latestExecution.worktreeBranch;
    const worktreePath = latestExecution.worktreePath;
    const localPath = task.project.localPath;

    // Determine the fork point: the commit where task branch diverged from base
    let forkPoint: string;
    try {
      forkPoint = execFileSync(
        "git", ["merge-base", baseBranch, worktreeBranch],
        { cwd: localPath, encoding: "utf-8", timeout: 5000 }
      ).trim();
    } catch {
      forkPoint = baseBranch;
    }

    // Strategy: diff from fork point, run inside worktree if it exists
    // This captures both committed AND uncommitted changes
    const diffCwd = (worktreePath && existsSync(worktreePath)) ? worktreePath : localPath;

    // numstat: committed changes (fork-point to branch HEAD) + uncommitted working dir changes
    const numstat = execFileSync(
      "git", ["diff", "--numstat", forkPoint],
      { cwd: diffCwd, encoding: "utf-8", timeout: 30000 }
    );

    // unified diff
    const unified = execFileSync(
      "git", ["diff", "--unified=3", forkPoint],
      { cwd: diffCwd, encoding: "utf-8", timeout: 30000 }
    );

    const parsedDiff = parseDiffOutput(numstat, unified);

    const { hasConflicts, conflictFiles } = checkConflicts(
      localPath,
      baseBranch,
      worktreeBranch
    );

    // Commit count on task branch since fork point
    let commitCount = 0;
    try {
      const commitCountStr = execFileSync(
        "git", ["rev-list", "--count", `${forkPoint}..${worktreeBranch}`],
        { cwd: localPath, encoding: "utf-8", timeout: 5000 }
      ).trim();
      commitCount = parseInt(commitCountStr, 10) || 0;
    } catch {
      // ignore
    }

    return NextResponse.json({
      ...parsedDiff,
      hasConflicts,
      conflictFiles,
      commitCount,
    });
  } catch (error) {
    console.error("[diff] Failed to generate diff:", error);
    return NextResponse.json(
      { error: "Failed to generate diff" },
      { status: 500 }
    );
  }
}
