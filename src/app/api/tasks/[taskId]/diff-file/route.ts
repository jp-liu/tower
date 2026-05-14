/**
 * Returns the before/after content of a single file in the task's diff.
 * Consumed by TaskDiffView's per-file Monaco DiffEditor (replaces the
 * @git-diff-view/react renderer which fails silently on certain inputs).
 *
 * GET /api/tasks/[taskId]/diff-file?file=<relativePath>
 *   → { before: string|null, after: string|null, isBinary: boolean }
 *
 *   `before` = file content at the fork commit (null if file didn't exist there)
 *   `after`  = file content at the merge end-ref (for DONE) or in the worktree
 *              (for IN_PROGRESS / IN_REVIEW). null if file was deleted.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { resolveTaskDiffSource } from "@/lib/task-diff-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reject anything that could escape the worktree.
function sanitizeFilePath(file: string): string {
  if (file.startsWith("/") || file.includes("..")) {
    throw new Error("invalid file path");
  }
  return file;
}

// Heuristic — treat content with a NUL byte in the first 8 KB as binary.
function looksBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 8192));
  return slice.indexOf(0) !== -1;
}

function showAtRef(
  cwd: string,
  ref: string,
  file: string
): string | null {
  try {
    return execFileSync(
      "git",
      [
        "-c", "core.quotepath=false",
        "show", `${ref}:${file}`,
      ],
      { cwd, encoding: "utf-8", timeout: 10000, maxBuffer: 32 * 1024 * 1024 }
    );
  } catch {
    // File didn't exist at this ref (newly added) → return null so the
    // client can show an empty "before" side.
    return null;
  }
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
    return NextResponse.json({ before: null, after: null, isBinary: false });
  }

  const { diffCwd, baseRef, endRef, worktreePath } = resolved.data;

  // BEFORE — content at the fork ref. Null = file didn't exist there.
  const before = showAtRef(diffCwd, baseRef, safeFile);

  // AFTER —
  //   DONE state: read from endRef commit.
  //   live (worktree or direct): read from disk so untracked + uncommitted
  //   edits are reflected.
  let after: string | null = null;
  let isBinary = false;
  if (endRef) {
    after = showAtRef(diffCwd, endRef, safeFile);
  } else {
    const fsPath = path.join(worktreePath ?? diffCwd, safeFile);
    if (existsSync(fsPath)) {
      try {
        const buf = readFileSync(fsPath);
        if (looksBinary(buf)) {
          isBinary = true;
        } else {
          after = buf.toString("utf-8");
        }
      } catch {
        after = null;
      }
    }
  }

  // Normalize CRLF → LF so Monaco's diff doesn't mark line-ending-only changes.
  return NextResponse.json({
    before: before === null ? null : before.replace(/\r\n/g, "\n"),
    after: after === null ? null : after.replace(/\r\n/g, "\n"),
    isBinary,
  });
}
