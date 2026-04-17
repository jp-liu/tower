import { readdirSync, statSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { homedir } from "os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Encode a filesystem path the same way Claude CLI does for ~/.claude/projects/ directory names.
 * Algorithm: strip leading "/", replace "/" with "-", replace each non-ASCII char with "-", prepend "-".
 */
function encodePathForClaude(path: string): string {
  const stripped = path.startsWith("/") ? path.slice(1) : path;
  let result = "";
  for (const ch of stripped) {
    if (ch === "/") {
      result += "-";
    } else if (ch.charCodeAt(0) > 127) {
      result += "-";
    } else {
      result += ch;
    }
  }
  return "-" + result;
}

/**
 * Find Claude session directory for a given cwd path.
 * Uses exact path encoding (matching Claude CLI's algorithm) with fallback to fuzzy matching.
 */
function findSessionDir(cwd: string): string | null {
  try {
    const dirs = readdirSync(PROJECTS_DIR);
    const encoded = encodePathForClaude(cwd);

    // 1. Exact match
    if (dirs.includes(encoded)) {
      return join(PROJECTS_DIR, encoded);
    }

    // 2. Fuzzy fallback — find dirs that start with the encoded path
    //    (handles edge cases where Claude CLI encoding differs slightly)
    const fuzzy = dirs.filter((dir) => dir === encoded || dir.startsWith(encoded + "-"));
    if (fuzzy.length > 0) {
      // Exclude worktree directories, prefer exact or shortest match
      const nonWorktree = fuzzy.filter((d) => !d.includes("-worktrees-"));
      const best = (nonWorktree.length > 0 ? nonWorktree : fuzzy)
        .sort((a, b) => a.length - b.length)[0];
      return join(PROJECTS_DIR, best);
    }

    return null;
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
