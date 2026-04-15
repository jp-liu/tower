import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { parseDiffOutput, checkConflicts, type DiffFile } from "@/lib/diff-parser";

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
    const localPath = task.project.localPath;

    const latestExecution = await db.taskExecution.findFirst({
      where: { taskId: parsed.data },
      orderBy: { createdAt: "desc" },
    });

    if (!latestExecution) {
      return NextResponse.json({
        files: [], totalAdded: 0, totalRemoved: 0,
        hasConflicts: false, conflictFiles: [], commitCount: 0,
      });
    }

    const forkCommit = latestExecution.forkCommit;
    const mergeCommit = latestExecution.mergeCommit;
    const branchTipCommit = latestExecution.branchTipCommit;
    const worktreeBranch = latestExecution.worktreeBranch;
    const worktreePath = latestExecution.worktreePath;

    let diffCwd: string;
    let diffTarget: string;

    if (mergeCommit && forkCommit) {
      // DONE state — use branchTipCommit to show only task's own changes,
      // falling back to mergeCommit for backward compatibility
      diffCwd = localPath;
      const endCommit = branchTipCommit || mergeCommit;
      diffTarget = `${forkCommit}..${endCommit}`;
    } else if (forkCommit && worktreePath && existsSync(worktreePath)) {
      // IN_PROGRESS/IN_REVIEW worktree mode — diff from fork point in worktree (includes uncommitted)
      diffCwd = worktreePath;
      diffTarget = forkCommit;
    } else if (forkCommit && !worktreePath) {
      // IN_PROGRESS/IN_REVIEW direct mode — diff from fork point on main repo
      diffCwd = localPath;
      diffTarget = forkCommit;
    } else if (worktreeBranch) {
      // Fallback — use branch names to compute merge-base
      try {
        const mb = execFileSync(
          "git", ["merge-base", baseBranch, worktreeBranch],
          { cwd: localPath, encoding: "utf-8", timeout: 5000 }
        ).trim();
        const wtp = worktreePath && existsSync(worktreePath) ? worktreePath : localPath;
        diffCwd = wtp;
        diffTarget = mb;
      } catch {
        return NextResponse.json({
          error: "Branch deleted", branchDeleted: true,
          files: [], totalAdded: 0, totalRemoved: 0,
          hasConflicts: false, conflictFiles: [], commitCount: 0,
        });
      }
    } else {
      return NextResponse.json({
        files: [], totalAdded: 0, totalRemoved: 0,
        hasConflicts: false, conflictFiles: [], commitCount: 0,
      });
    }

    // Run numstat + unified diff
    const numstat = execFileSync(
      "git", ["diff", "--numstat", diffTarget],
      { cwd: diffCwd, encoding: "utf-8", timeout: 30000 }
    );
    const unified = execFileSync(
      "git", ["diff", "--unified=3", diffTarget],
      { cwd: diffCwd, encoding: "utf-8", timeout: 30000 }
    );

    const parsedDiff = parseDiffOutput(numstat, unified);

    // Include untracked files for live worktree diffs (not DONE state)
    if (!mergeCommit && worktreePath && existsSync(worktreePath)) {
      try {
        const untrackedOutput = execFileSync(
          "git", ["ls-files", "--others", "--exclude-standard"],
          { cwd: diffCwd, encoding: "utf-8", timeout: 5000 }
        ).trim();
        if (untrackedOutput) {
          for (const filename of untrackedOutput.split("\n")) {
            if (!filename) continue;
            try {
              const filePath = path.join(diffCwd, filename);
              const content = readFileSync(filePath, "utf-8");
              const lines = content.split("\n");
              // Remove trailing empty line from split
              if (lines[lines.length - 1] === "") lines.pop();
              const lineCount = lines.length;
              const patchLines = [
                `diff --git a/${filename} b/${filename}`,
                "new file mode 100644",
                "--- /dev/null",
                `+++ b/${filename}`,
                `@@ -0,0 +1,${lineCount} @@`,
                ...lines.map((l) => `+${l}`),
              ];
              const entry: DiffFile = {
                filename,
                added: lineCount,
                removed: 0,
                isBinary: false,
                patch: patchLines.join("\n"),
              };
              parsedDiff.files.push(entry);
              parsedDiff.totalAdded += lineCount;
            } catch {
              // Skip binary or unreadable files
            }
          }
        }
      } catch {
        // ignore — best effort
      }
    }

    // Conflict check only relevant before merge
    let hasConflicts = false;
    let conflictFiles: string[] = [];
    if (!mergeCommit && worktreeBranch) {
      ({ hasConflicts, conflictFiles } = checkConflicts(localPath, baseBranch, worktreeBranch));
    }

    // Commit count
    let commitCount = 0;
    if (mergeCommit && forkCommit) {
      try {
        const endCommit = branchTipCommit || mergeCommit;
        const str = execFileSync(
          "git", ["rev-list", "--count", `${forkCommit}..${endCommit}`],
          { cwd: diffCwd, encoding: "utf-8", timeout: 5000 }
        ).trim();
        commitCount = parseInt(str, 10) || 0;
      } catch {
        // ignore
      }
    } else if (forkCommit) {
      try {
        const str = execFileSync(
          "git", ["rev-list", "--count", `${forkCommit}..HEAD`],
          { cwd: diffCwd, encoding: "utf-8", timeout: 5000 }
        ).trim();
        commitCount = parseInt(str, 10) || 0;
      } catch {
        // ignore
      }
    } else if (worktreeBranch) {
      try {
        const commitCountStr = execFileSync(
          "git", ["rev-list", "--count", `${diffTarget}..${worktreeBranch}`],
          { cwd: localPath, encoding: "utf-8", timeout: 5000 }
        ).trim();
        commitCount = parseInt(commitCountStr, 10) || 0;
      } catch {
        // ignore
      }
    }

    // Check for uncommitted changes in worktree
    let hasUncommitted = false;
    if (worktreePath && existsSync(worktreePath) && !mergeCommit) {
      try {
        const status = execFileSync(
          "git", ["status", "--porcelain"],
          { cwd: worktreePath, encoding: "utf-8", timeout: 5000 }
        ).trim();
        hasUncommitted = status.length > 0;
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      ...parsedDiff,
      hasConflicts,
      conflictFiles,
      commitCount,
      hasUncommitted,
    });
  } catch (error) {
    console.error("[diff] Failed to generate diff:", error);
    return NextResponse.json(
      { error: "Failed to generate diff" },
      { status: 500 }
    );
  }
}
