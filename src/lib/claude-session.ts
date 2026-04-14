import { readdirSync, statSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { homedir } from "os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Find Claude session directory by scanning ~/.claude/projects/ for directories
 * that match the given cwd path. Claude CLI encodes paths by replacing various
 * characters (including non-ASCII) with dashes, so exact key computation is unreliable.
 * Instead, we look for directories whose name contains recognizable path segments.
 */
function findSessionDir(cwd: string): string | null {
  try {
    const dirs = readdirSync(PROJECTS_DIR);

    // Extract key path segments from cwd (last 2-3 meaningful directory names)
    const segments = cwd.split("/").filter(Boolean);
    // Use the last few unique segments for matching
    const matchSegments = segments.slice(-3).map((s) => s.replace(/[/.]/g, "-"));

    // Find directories that match all segments
    const matches = dirs.filter((dir) => {
      return matchSegments.every((seg) => dir.includes(seg));
    });

    if (matches.length === 0) return null;

    // If multiple matches, prefer exact cwd match, then most recently modified
    const withStats = matches.map((dir) => {
      const fullPath = join(PROJECTS_DIR, dir);
      try {
        return { dir, path: fullPath, mtime: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    }).filter(Boolean) as { dir: string; path: string; mtime: number }[];

    withStats.sort((a, b) => b.mtime - a.mtime);
    return withStats[0]?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the latest .jsonl session file in a Claude projects directory.
 */
function findLatestSessionInDir(sessionsDir: string): string | null {
  try {
    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        id: f.replace(".jsonl", ""),
        mtime: statSync(join(sessionsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the latest Claude CLI session ID for a given working directory.
 * Scans ~/.claude/projects/ to find matching session directories.
 */
export function findLatestSessionId(cwd: string): string | null {
  // Try the cwd directly
  const dir = findSessionDir(cwd);
  if (dir) {
    const id = findLatestSessionInDir(dir);
    if (id) return id;
  }

  // Fallback: if cwd is a worktree, try the parent project root
  const worktreeMatch = cwd.match(/(.+)\/.worktrees\/task-/);
  if (worktreeMatch) {
    const parentDir = findSessionDir(worktreeMatch[1]);
    if (parentDir) {
      return findLatestSessionInDir(parentDir);
    }
  }

  return null;
}

/**
 * Generate an AI summary from terminal log content.
 * Uses `claude -p` with --no-session-persistence to avoid polluting any session.
 * Runs asynchronously — returns a Promise.
 */
export function generateSummaryFromLog(
  terminalLog: string,
  cwd: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const prompt = `以下是一次AI编程助手的终端会话记录。请用一句简短的中文总结这次会话做了什么（不超过50字，只回答总结内容，不要加引号或前缀）：

\`\`\`
${terminalLog.slice(-5000)}
\`\`\``;

    execFile(
      "claude",
      ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
      {
        cwd,
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env },
      },
      (err, stdout) => {
        if (err) {
          console.error("[generateSummaryFromLog] Failed:", err.message?.slice(0, 100));
          resolve(null);
          return;
        }
        const result = stdout.trim().replace(/^[#*\->"'\s]+/, "").trim();
        resolve(result || null);
      }
    );
  });
}
