import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { execSync } from "child_process";
import { parseDiffOutput, checkConflicts } from "@/lib/diff-parser";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  // Validate taskId with Zod (per project Zod convention)
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

    // Run numstat diff
    const numstat = execSync(
      `git diff --numstat ${task.baseBranch}...${worktreeBranch}`,
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );

    // Run unified diff
    const unified = execSync(
      `git diff --unified=3 ${task.baseBranch}...${worktreeBranch}`,
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );

    // Parse diff output
    const parsedDiff = parseDiffOutput(numstat, unified);

    // Check for merge conflicts
    const { hasConflicts, conflictFiles } = checkConflicts(
      localPath,
      task.baseBranch,
      worktreeBranch
    );

    // Get commit count
    const commitCountStr = execSync(
      `git rev-list --count ${task.baseBranch}...${worktreeBranch}`,
      { cwd: localPath, encoding: "utf-8", timeout: 5000 }
    ).trim();
    const commitCount = parseInt(commitCountStr, 10) || 0;

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
