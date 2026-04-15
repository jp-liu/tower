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

    // Extract ASCII-only path segments for matching (skip non-ASCII segments like Chinese)
    const segments = cwd.split("/").filter(Boolean);
    const asciiSegments = segments
      .map((s) => s.replace(/[/.]/g, "-"))
      .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s));
    // Use the last few ASCII segments for matching
    const matchSegments = asciiSegments.slice(-3);

    if (matchSegments.length === 0) return null;

    // Find directories that match all ASCII segments
    const matches = dirs.filter((dir) => {
      return matchSegments.every((seg) => dir.includes(seg));
    });

    if (matches.length === 0) return null;

    // If multiple matches, prefer the one with most segments matched, then most recently modified
    const withStats = matches.map((dir) => {
      const fullPath = join(PROJECTS_DIR, dir);
      try {
        // Score: count how many total path segments appear in the dir name
        const score = segments
          .map((s) => s.replace(/[/.]/g, "-"))
          .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s) && dir.includes(s))
          .length;
        return { dir, path: fullPath, score, mtime: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    }).filter(Boolean) as { dir: string; path: string; score: number; mtime: number }[];

    // Sort by score descending, then mtime descending
    withStats.sort((a, b) => b.score - a.score || b.mtime - a.mtime);

    // Exclude worktree directories (they contain .worktrees in the name)
    const nonWorktree = withStats.filter((w) => !w.dir.includes("-worktrees-"));
    return (nonWorktree[0] || withStats[0])?.path ?? null;
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
