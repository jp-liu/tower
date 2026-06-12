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
import { aiQuery } from "@/lib/claude-session";
import { resolveTaskDiffSource } from "@/lib/task-diff-resolver";
import { parseDiffOutput, type DiffFile } from "@/lib/diff-parser";
import {
  buildFallbackSummary,
  buildNoteTitle,
  formatNoteContent,
  type OverviewKind,
  type TaskAsset,
  type TaskChangeData,
} from "@/lib/task-overview-format";

/** Note category for auto-generated task overviews. Keep in sync with
 *  NOTE_CATEGORIES_PRESET in src/lib/constants.ts. */
export const TASK_OVERVIEW_CATEGORY = "任务笔记";

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
async function generateChangeSummary(data: TaskChangeData): Promise<string | null> {
  const fileListText =
    data.files
      .slice(0, FILE_LIST_PROMPT_MAX)
      .map((f) =>
        f.isBinary
          ? `${f.filename} (binary)`
          : `${f.filename} (+${f.added}/-${f.removed})`
      )
      .join("\n") || "（无文件清单）";

  const prompt = `你是资深工程师。下面是一个刚完成的开发任务的代码改动信息，请用简洁中文写一段「改动摘要」：说明这次改动做了什么、解决了什么问题、主要涉及哪些模块或逻辑。要求 3-6 句、纯文本，不要 markdown 标题，不要逐条罗列文件（文件清单会另外展示）。

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
  const result = await aiQuery(prompt, cwd, { maxTurns: 1 });
  if (result) {
    const cleaned = result.replace(/^[#*\->"'\s]+/, "").trim();
    if (cleaned) return cleaned;
  }
  return buildFallbackSummary(data.commitLog);
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
  } catch (err) {
    console.error("[captureTaskOverview] Failed to gather change data:", err);
    return;
  }

  if (!data) {
    console.error(`[captureTaskOverview] No changes for task=${taskId.slice(0, 8)} — skip`);
    return;
  }
  const captured = data;

  // Detached: AI summary + note write. Worktree is already free to be removed
  // — the git data was captured above and the AI query is text-only.
  void (async () => {
    try {
      const summary = await generateChangeSummary(captured);
      const generatedAt = new Date().toISOString();
      const content = formatNoteContent(captured, summary, generatedAt, kind);
      const title = buildNoteTitle(captured.taskTitle, kind);

      const note = await db.projectNote.create({
        data: {
          title,
          content,
          category: TASK_OVERVIEW_CATEGORY,
          projectId: captured.projectId,
          // taskId stays null so the note surfaces in the project Notes page
          // (getProjectNotes filters taskId:null). The task linkage lives as a
          // text backlink in the note body instead.
          taskId: null,
        },
      });
      await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
      console.error(
        `[captureTaskOverview] Note created: ${note.id} for task=${taskId.slice(0, 8)}`
      );
    } catch (err) {
      console.error("[captureTaskOverview] Failed to create overview note:", err);
    }
  })();
}
