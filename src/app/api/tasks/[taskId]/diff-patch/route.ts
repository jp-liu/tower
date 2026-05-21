/**
 * Returns the unified-diff patch for a single file in the task's diff.
 * Consumed by TaskDiffView's inline hunk renderer (replaces the Monaco
 * full-file diff route — we only need hunks, not entire file contents).
 *
 * GET /api/tasks/[taskId]/diff-patch?file=<relativePath>
 *   → { kind: "tracked"|"untracked"|"binary"|"empty", patch: string }
 *
 * For tracked files: runs `git diff --unified=3 <diffTarget> -- <file>`.
 * For untracked files (live worktree only): synthesizes a "new file" patch
 * from disk content so the row still renders something.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { resolveTaskDiffSource } from "@/lib/task-diff-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeFilePath(file: string): string {
  if (file.startsWith("/") || file.includes("..")) {
    throw new Error("invalid file path");
  }
  return file;
}

function looksBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 8192));
  return slice.indexOf(0) !== -1;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const parsed = z.string().cuid().safeParse(taskId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  }

  const file = request.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  let safeFile: string;
  try {
    safeFile = sanitizeFilePath(file);
  } catch {
    return NextResponse.json({ error: "invalid file path" }, { status: 400 });
  }

  const resolved = await resolveTaskDiffSource(parsed.data);
  if (resolved.kind === "error") {
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status }
    );
  }
  if (resolved.kind === "empty" || resolved.kind === "branch-deleted") {
    return NextResponse.json({ kind: "empty", patch: "" });
  }

  const { diffCwd, diffTarget, worktreePath } = resolved.data;

  // 32MB cap survives one giant generated-file patch (pdfjs, lockfiles); the
  // UI still folds anything over the line budget so we rarely actually hit it.
  let patch: string;
  try {
    patch = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "diff", "--unified=3", diffTarget, "--", safeFile],
      { cwd: diffCwd, encoding: "utf-8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 }
    );
  } catch {
    return NextResponse.json(
      { error: "failed to compute diff" },
      { status: 500 }
    );
  }

  if (patch.length > 0) {
    if (/^Binary files /m.test(patch)) {
      return NextResponse.json({ kind: "binary", patch: "" });
    }
    return NextResponse.json({ kind: "tracked", patch });
  }

  // No git-tracked diff for this path — likely an untracked file in the live
  // worktree. Synthesize a "new file" patch from disk so the row renders.
  const base = worktreePath ?? diffCwd;
  const filePath = path.join(base, safeFile);
  if (!existsSync(filePath)) {
    return NextResponse.json({ kind: "empty", patch: "" });
  }

  try {
    const buf = readFileSync(filePath);
    if (looksBinary(buf)) {
      return NextResponse.json({ kind: "binary", patch: "" });
    }
    const content = buf.toString("utf-8");
    const lines = content.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const lineCount = lines.length;
    const synthesized = [
      `diff --git a/${safeFile} b/${safeFile}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${safeFile}`,
      `@@ -0,0 +1,${lineCount} @@`,
      ...lines.map((l) => `+${l}`),
    ].join("\n");
    return NextResponse.json({ kind: "untracked", patch: synthesized });
  } catch {
    return NextResponse.json({ kind: "empty", patch: "" });
  }
}
