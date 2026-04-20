import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { findLatestSessionId, generateSummaryFromLog, generateDreamingInsight, DreamingResult } from "@/lib/claude-session";

const TERMINAL_LOG_MAX = 10 * 1024; // 10 KB

/** Format dreaming insights into readable Markdown content */
function formatDreamingContent(dream: DreamingResult): string {
  const lines: string[] = [];
  lines.push("## Summary");
  lines.push(dream.summary);
  lines.push("");

  if (dream.insights.length > 0) {
    lines.push("## Insights");
    for (const insight of dream.insights) {
      lines.push(`- **[${insight.type}]**: ${insight.content}`);
    }
  }

  return lines.join("\n");
}

interface GitStats {
  commits: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    timeout: 10_000,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function getMergeBase(cwd: string): string | null {
  // Try common base branch names
  for (const base of ["main", "master", "develop"]) {
    try {
      return runGit(["merge-base", "HEAD", base], cwd);
    } catch {
      // branch doesn't exist, try next
    }
  }
  return null;
}

function captureGitLog(cwd: string): string | null {
  try {
    const mergeBase = getMergeBase(cwd);
    if (mergeBase) {
      const log = runGit(["log", "--oneline", `${mergeBase}..HEAD`], cwd);
      if (log) return log;
    }
    // Fallback: last 3 commits
    return runGit(["log", "--oneline", "-3"], cwd) || null;
  } catch {
    return null;
  }
}

function captureGitStats(cwd: string): GitStats | null {
  try {
    let diffOutput: string;
    const mergeBase = getMergeBase(cwd);
    if (mergeBase) {
      diffOutput = runGit(["diff", "--stat", `${mergeBase}..HEAD`], cwd);
    } else {
      // Fallback
      diffOutput = runGit(["diff", "--stat", "HEAD~20", "HEAD"], cwd);
    }
    if (!diffOutput) return null;
    return parseDiffStat(diffOutput);
  } catch {
    return null;
  }
}

function parseDiffStat(output: string): GitStats | null {
  // Match the summary line: "5 files changed, 47 insertions(+), 12 deletions(-)"
  const lines = output.split("\n");
  const summaryLine = lines[lines.length - 1];
  if (!summaryLine) return null;

  const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
  const insertionsMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
  const deletionsMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);

  if (!filesMatch && !insertionsMatch && !deletionsMatch) return null;

  return {
    commits: 0, // filled in by caller
    filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
    insertions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
    deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
  };
}

function buildSummary(gitLog: string | null): string | null {
  if (!gitLog) return null;
  const lines = gitLog.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  // Extract commit message (after the short hash)
  const firstMessage = lines[0].replace(/^[a-f0-9]+\s+/, "");
  if (lines.length === 1) return firstMessage;
  return `${lines.length} commits: ${firstMessage}`;
}

/** Strip ANSI escape sequences, cursor control, and OSC sequences from terminal output */
function stripAnsi(str: string): string {
  return str
    // OSC sequences (e.g. title set): ESC ] ... ST/BEL
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // CSI sequences (e.g. colors, cursor): ESC [ ... final_byte
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    // Other ESC sequences
    .replace(/\x1b[^[\]()][^\x1b]*/g, "")
    // Bare control chars (except \n \r \t)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimTerminalBuffer(buffer: string): string {
  const clean = stripAnsi(buffer);
  if (clean.length <= TERMINAL_LOG_MAX) return clean;
  return clean.slice(clean.length - TERMINAL_LOG_MAX);
}

/**
 * Capture an execution summary after a PTY session ends.
 * This function is designed to never throw — all errors are caught and logged.
 */
export async function captureExecutionSummary(
  executionId: string,
  _taskId: string,
  exitCode: number,
  terminalBuffer: string,
  worktreePath: string | null
): Promise<void> {
  try {
    console.error(`[captureExecutionSummary] Starting: exec=${executionId.slice(0, 8)} exit=${exitCode} buffer=${terminalBuffer.length}chars worktree=${worktreePath}`);

    let gitLog: string | null = null;
    let gitStats: GitStats | null = null;
    let summary: string | null = null;

    // Capture git data if we have a valid git worktree
    if (worktreePath && existsSync(worktreePath)) {
      try {
        // Verify it's a git repo
        runGit(["rev-parse", "--git-dir"], worktreePath);

        gitLog = captureGitLog(worktreePath);
        gitStats = captureGitStats(worktreePath);

        // Fill in commit count from gitLog
        if (gitStats && gitLog) {
          const commitCount = gitLog.split("\n").filter(Boolean).length;
          gitStats = { ...gitStats, commits: commitCount };
        }

        summary = buildSummary(gitLog);
      } catch {
        // Not a git repo or git not available — continue without git data
      }
    }

    const terminalLog = trimTerminalBuffer(terminalBuffer);

    // Capture Claude CLI session ID
    let claudeSessionId: string | null = null;
    if (worktreePath) {
      claudeSessionId = findLatestSessionId(worktreePath);
      console.error(`[captureExecutionSummary] Claude session ID: ${claudeSessionId}`);
    }

    // Phase 1: Immediate save — git data + terminal log + session ID (no blocking)
    await db.taskExecution.update({
      where: { id: executionId },
      data: {
        summary: summary ?? (gitLog ? buildSummary(gitLog) : null),
        sessionId: claudeSessionId,
        gitLog: gitLog ?? null,
        gitStats: gitStats ? JSON.stringify(gitStats) : null,
        exitCode,
        terminalLog: terminalLog || null,
      },
    });

    // Phase 2: Background AI summary — fire and forget, updates DB when done
    // Phase 3: Dreaming — chains off Phase 2, creates ProjectNote if insights found
    if (terminalLog && worktreePath) {
      console.error("[captureExecutionSummary] Starting background AI summary...");
      generateSummaryFromLog(terminalLog, worktreePath)
        .then(async (aiSummary) => {
          if (aiSummary) {
            console.error(`[captureExecutionSummary] AI summary ready: ${aiSummary.slice(0, 80)}`);
            await db.taskExecution.update({
              where: { id: executionId },
              data: { summary: aiSummary },
            });
          }
          return aiSummary;
        })
        .then(async (aiSummary) => {
          // Phase 3: Dreaming — generate insights from the session
          console.error("[captureExecutionSummary] Starting dreaming analysis...");
          const dream = await generateDreamingInsight(terminalLog, worktreePath!, aiSummary);
          if (!dream || !dream.shouldCreateNote) {
            console.error("[captureExecutionSummary] Dreaming: no note needed");
            return;
          }

          // Find the task's projectId
          const execution = await db.taskExecution.findUnique({
            where: { id: executionId },
            select: { taskId: true, task: { select: { projectId: true } } },
          });
          if (!execution) return;

          // Create the ProjectNote
          const note = await db.projectNote.create({
            data: {
              title: dream.noteTitle || dream.summary.slice(0, 50),
              content: formatDreamingContent(dream),
              category: "session-insight",
              projectId: execution.task.projectId,
              taskId: execution.taskId,
            },
          });

          // Link note to execution
          await db.taskExecution.update({
            where: { id: executionId },
            data: { insightNoteId: note.id },
          });

          console.error(`[captureExecutionSummary] Dreaming note created: ${note.id}`);
        })
        .catch((err: unknown) => {
          console.error("[captureExecutionSummary] Background AI summary/dreaming failed:", err);
        });
    }
  } catch (err: unknown) {
    console.error("[captureExecutionSummary] Failed to capture summary:", err);
  }
}
