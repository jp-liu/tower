/**
 * Task change overview — auto-generated when a task enters DONE.
 *
 * Captures what the task changed (AI summary + file list + linked
 * references/assets) and persists it as a ProjectNote under the
 * "任务笔记" category, so the work can be reviewed / referenced later
 * (e.g. when a regression needs a fresh task that links back to it).
 *
 * IMPORTANT — timing: the git data is gathered in `gatherTaskChangeData`,
 * which is `await`ed by `captureTaskOverview` BEFORE it returns. Call sites
 * that clean up the worktree (the merge route) must therefore `await
 * captureTaskOverview(...)` BEFORE `removeWorktree(...)`. The slow AI summary
 * + note write run detached afterwards and never touch the worktree.
 *
 * Fault tolerance: every path is wrapped — this module never throws and
 * never blocks the DONE transition. Failures are logged, not propagated.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { syncNoteToFts } from "@/lib/fts";
import { CapabilityRuntimeError } from "@tower/ai-runtime";
import { generateCapabilityText } from "@/lib/ai/capability-executor";
import { getConfigValue } from "@/actions/config-actions";
import { resolveTaskDiffSource } from "@/lib/task-diff-resolver";
import { parseDiffOutput, type DiffFile } from "@/lib/diff-parser";
import { TASK_OVERVIEW_CATEGORY } from "@/lib/constants";
import type { Locale } from "@/lib/i18n";
import { redactSecretString } from "@/lib/secret-redaction";
import {
  buildFallbackSummary,
  buildNoteTitle,
  formatNoteContent,
  type OverviewKind,
  type TaskAsset,
  type TaskChangeData,
} from "@/lib/task-overview-format";

const DIFF_TEXT_MAX = 12 * 1024; // 12 KB of raw diff fed to the AI prompt
const FILE_LIST_PROMPT_MAX = 60; // files listed in the AI prompt
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function runGit(args: string[], cwd: string, maxBuffer = 1024 * 1024): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Collect the change data for a task. Runs git reads synchronously (awaited)
 * so callers can guarantee it completes before any worktree cleanup.
 * Returns null when there is nothing worth recording (no commits and no
 * changed files) — satisfies the "only generate when there are real changes"
 * requirement.
 */
async function gatherTaskChangeData(taskId: string): Promise<TaskChangeData | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task || !task.project) return null;

  const localPath = task.project.localPath ?? null;

  let files: DiffFile[] = [];
  let commitLog: string | null = null;
  let commitCount = 0;
  let diffText: string | null = null;
  let cwd = localPath || process.cwd();

  if (localPath) {
    const resolved = await resolveTaskDiffSource(taskId);
    if (resolved.kind === "ok") {
      const { diffCwd, diffTarget } = resolved.data;
      cwd = diffCwd;

      // diffTarget is either a "<fork>..<end>" range (DONE state) or a single
      // base SHA (live worktree). For commit log/count we always want a range.
      const logRange = diffTarget.includes("..") ? diffTarget : `${diffTarget}..HEAD`;

      const numstat = runGit(["diff", "--numstat", diffTarget], diffCwd, GIT_MAX_BUFFER);
      if (numstat) {
        files = parseDiffOutput(numstat, "").files;
      }

      commitLog = runGit(["log", "--oneline", logRange], diffCwd) || null;
      const countStr = runGit(["rev-list", "--count", logRange], diffCwd);
      commitCount = countStr ? parseInt(countStr, 10) || 0 : 0;

      const rawDiff = runGit(["diff", diffTarget], diffCwd, GIT_MAX_BUFFER);
      if (rawDiff) {
        diffText =
          rawDiff.length > DIFF_TEXT_MAX
            ? rawDiff.slice(0, DIFF_TEXT_MAX) + "\n...(diff truncated)"
            : rawDiff;
      }
    }
  }

  // Fallback: direct-mode / unresolved tasks have no diff source. Use whatever
  // the last execution captured at the time it ended.
  if (files.length === 0 && commitCount === 0) {
    const latestExec = await db.taskExecution.findFirst({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      select: { gitLog: true, worktreePath: true },
    });
    if (latestExec?.gitLog) {
      commitLog = latestExec.gitLog;
      commitCount = latestExec.gitLog.split("\n").filter(Boolean).length;
    }
    if (latestExec?.worktreePath && existsSync(latestExec.worktreePath)) {
      cwd = latestExec.worktreePath;
    }
  }

  // Gate: nothing changed → skip (no empty overview notes).
  if (files.length === 0 && commitCount === 0) return null;

  const assetRows = await db.projectAsset.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: { filename: true, description: true },
  });
  const assets: TaskAsset[] = assetRows.map((a) => ({
    filename: a.filename,
    description: a.description,
  }));

  return {
    taskId,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.project.name,
    files,
    commitLog,
    commitCount,
    diffText,
    assets,
    cwd,
  };
}

/** Ask the AI for a concise change summary; fall back to the commit log. */
export async function generateChangeSummary(
  data: TaskChangeData,
  locale: Locale
): Promise<string | null> {
  const fileListText =
    data.files
      .slice(0, FILE_LIST_PROMPT_MAX)
      .map((f) =>
        f.isBinary
          ? `${f.filename} (binary)`
          : `${f.filename} (+${f.added}/-${f.removed})`
      )
      .join("\n") || (locale === "en" ? "(no file list)" : "（无文件清单）");

  const prompt =
    locale === "en"
      ? `You are a senior engineer. Below is the code-change information for a development task that was just completed. Write a concise "Change Summary" in English: explain what this change did, what problem it solved, and which modules or logic it mainly touched. Requirements: 3-6 sentences, plain text, no markdown headings, do not enumerate files one by one (the file list is shown separately).

Task title: ${data.taskTitle}

Commit log:
${data.commitLog ?? "(no commit log)"}

Changed files (${data.files.length} total):
${fileListText}

diff (may be truncated):
\`\`\`diff
${data.diffText ?? "(no diff)"}
\`\`\``
      : `你是资深工程师。下面是一个刚完成的开发任务的代码改动信息，请用简洁中文写一段「改动摘要」：说明这次改动做了什么、解决了什么问题、主要涉及哪些模块或逻辑。要求 3-6 句、纯文本，不要 markdown 标题，不要逐条罗列文件（文件清单会另外展示）。

任务标题：${data.taskTitle}

提交记录：
${data.commitLog ?? "（无提交记录）"}

变更文件（共 ${data.files.length} 个）：
${fileListText}

diff（可能已截断）：
\`\`\`diff
${data.diffText ?? "（无 diff）"}
\`\`\``;

  const cwd = existsSync(data.cwd) ? data.cwd : process.cwd();
  try {
    const result = await generateCapabilityText({
      slot: "summary",
      prompt,
      cwd,
      correlationId: data.taskId,
      maxTurns: 1,
      maxOutputTokens: 800,
      maxOutputChars: 3000,
      temperature: 0.2,
    });
    const cleaned = result.replace(/^[#*\->"'\s]+/, "").trim();
    if (cleaned) return cleaned;
  } catch (error) {
    const code = error instanceof CapabilityRuntimeError ? error.code : "internal_error";
    console.error(`[captureTaskOverview] AI summary failed: code=${code}`);
  }
  return buildFallbackSummary(data.commitLog, locale);
}

/**
 * Generate a task change overview note. Gathers git data synchronously (so it
 * is safe to run before worktree cleanup), then writes the note in the
 * background. Never throws.
 *
 * @param opts.kind "done" (default) for completed tasks, "cancelled" to record
 *   a cancelled task's partial work as restart experience.
 */
export async function captureTaskOverview(
  taskId: string,
  opts: { kind?: OverviewKind } = {}
): Promise<void> {
  const kind = opts.kind ?? "done";
  let data: TaskChangeData | null = null;
  try {
    data = await gatherTaskChangeData(taskId);
  } catch {
    console.error("[captureTaskOverview] Failed to gather change data: code=internal_error");
    return;
  }

  if (!data) {
    console.error(`[captureTaskOverview] No changes for task=${taskId.slice(0, 8)} — skip`);
    return;
  }
  const captured = data;

  // Follow the current UI language. locale lives in the browser only, so the UI
  // persists the last-switched value to systemConfig for backend readers here.
  const locale = await getConfigValue<Locale>("locale", "zh");

  // Detached: AI summary + note write. Worktree is already free to be removed
  // — the git data was captured above and the AI query is text-only.
  void (async () => {
    try {
      const summary = await generateChangeSummary(captured, locale);
      const generatedAt = new Date().toISOString();
      const content = redactSecretString(formatNoteContent(captured, summary, generatedAt, kind, locale));
      const title = redactSecretString(buildNoteTitle(captured.taskTitle, kind, locale));

      const note = await db.projectNote.create({
        data: {
          title,
          content,
          category: TASK_OVERVIEW_CATEGORY,
          projectId: captured.projectId,
          // Bind to the task so the note surfaces both in the project Notes page
          // (getProjectNotes no longer filters by taskId) and inside the task's
          // overview drawer (getTaskNotes). A text backlink in the body remains
          // as a human-readable reference.
          taskId: captured.taskId,
        },
      });
      await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
      console.error(
        `[captureTaskOverview] Note created: ${note.id} for task=${taskId.slice(0, 8)}`
      );
    } catch {
      console.error("[captureTaskOverview] Failed to create overview note: code=internal_error");
    }
  })();
}
