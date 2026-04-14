import { readdirSync, statSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { homedir } from "os";

/**
 * Claude CLI encodes project paths by replacing / and . with -
 */
function getProjectKey(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/**
 * Find the latest Claude CLI session ID in the sessions directory for a given cwd.
 */
function findSessionInDir(cwd: string): string | null {
  try {
    const projectKey = getProjectKey(cwd);
    const sessionsDir = join(homedir(), ".claude", "projects", projectKey);

    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        name: f,
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
 * Falls back to the parent project root when cwd is a worktree path.
 */
export function findLatestSessionId(cwd: string): string | null {
  // Try the given cwd first
  const result = findSessionInDir(cwd);
  if (result) return result;

  // Fallback: if cwd is a worktree, try the parent project root
  const worktreeMatch = cwd.match(/(.+)\/.worktrees\/task-/);
  if (worktreeMatch) {
    return findSessionInDir(worktreeMatch[1]);
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
