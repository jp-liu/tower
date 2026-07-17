/**
 * Pure formatting helpers for task change overviews.
 *
 * Kept free of node/db/AI imports so it can be unit-tested in isolation and
 * reused by `task-overview.ts` (which owns the IO + AI side effects).
 */

import type { DiffFile } from "@/lib/diff-parser";
import type { Locale } from "@/lib/i18n";

const FILE_LIST_NOTE_MAX = 100; // files listed in the note body
const COMMIT_LIST_NOTE_MAX = 50; // commits listed in the note body

export interface TaskAsset {
  filename: string;
  description: string | null;
}

/** Why the overview was generated — affects the note title and intro line. */
export type OverviewKind = "done" | "cancelled";

export interface TaskChangeData {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  files: DiffFile[];
  commitLog: string | null;
  commitCount: number;
  diffText: string | null;
  assets: TaskAsset[];
  /** Directory to run the AI query from (validated to exist before use). */
  cwd: string;
}

/** Localized copy for the overview note. Follows the current UI language. */
const STRINGS = {
  zh: {
    titleDone: "任务概览：",
    titleCancelled: "任务概览（已取消）：",
    introDone: "> 本笔记由任务完成时自动生成，记录本次任务的改动概览，便于后续复盘与排查。",
    introCancelled: "> 本笔记由任务取消时自动生成，记录已产生的改动，作为下次重启该任务的参考经验。",
    summaryHeading: "## 改动摘要",
    summaryMissing: "（未能生成改动摘要）",
    fileListHeading: "## 文件清单",
    binary: "（二进制）",
    moreFiles: (n: number) => `- …其余 ${n} 个文件`,
    fileCommitCount: (files: number, commits: number) => `共 ${files} 个文件、${commits} 个提交。`,
    noFileList: (commits: number) => `（未能获取精确文件清单，本次约 ${commits} 个提交。）`,
    commitsHeading: "## 提交记录",
    moreCommits: (n: number) => `- …其余 ${n} 个提交`,
    assetsHeading: "## 相关附件与参考资料",
    none: "（无）",
    fallbackMulti: (n: number, first: string) => `${n} 个提交：${first}`,
    task: "关联任务：",
    project: "项目：",
    generatedAt: "生成时间：",
  },
  en: {
    titleDone: "Task Overview: ",
    titleCancelled: "Task Overview (Cancelled): ",
    introDone:
      "> This note was auto-generated when the task completed, recording an overview of the changes for later review and troubleshooting.",
    introCancelled:
      "> This note was auto-generated when the task was cancelled, recording the changes already made as reference for restarting the task later.",
    summaryHeading: "## Change Summary",
    summaryMissing: "(Failed to generate change summary)",
    fileListHeading: "## File List",
    binary: " (binary)",
    moreFiles: (n: number) => `- …and ${n} more files`,
    fileCommitCount: (files: number, commits: number) => `${files} file(s), ${commits} commit(s).`,
    noFileList: (commits: number) =>
      `(No precise file list available; about ${commits} commit(s) this time.)`,
    commitsHeading: "## Commits",
    moreCommits: (n: number) => `- …and ${n} more commits`,
    assetsHeading: "## Related Attachments & References",
    none: "(none)",
    fallbackMulti: (n: number, first: string) => `${n} commits: ${first}`,
    task: "Task: ",
    project: "Project: ",
    generatedAt: "Generated at: ",
  },
} as const;

/** Best-effort one-line summary from a git oneline log, used when AI fails. */
export function buildFallbackSummary(
  commitLog: string | null,
  locale: Locale = "zh"
): string | null {
  if (!commitLog) return null;
  const lines = commitLog.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const first = lines[0].replace(/^[a-f0-9]+\s+/, "");
  return lines.length === 1 ? first : STRINGS[locale].fallbackMulti(lines.length, first);
}

/** Note title for an overview. */
export function buildNoteTitle(
  taskTitle: string,
  kind: OverviewKind = "done",
  locale: Locale = "zh"
): string {
  const s = STRINGS[locale];
  const prefix = kind === "cancelled" ? s.titleCancelled : s.titleDone;
  return `${prefix}${taskTitle}`.slice(0, 200);
}

/** Render the overview note body (Markdown). */
export function formatNoteContent(
  data: TaskChangeData,
  summary: string | null,
  generatedAt: string,
  kind: OverviewKind = "done",
  locale: Locale = "zh"
): string {
  const s = STRINGS[locale];
  const lines: string[] = [];
  lines.push(kind === "cancelled" ? s.introCancelled : s.introDone);
  lines.push("");

  lines.push(s.summaryHeading);
  lines.push(summary ?? s.summaryMissing);
  lines.push("");

  lines.push(s.fileListHeading);
  if (data.files.length > 0) {
    const shown = data.files.slice(0, FILE_LIST_NOTE_MAX);
    for (const f of shown) {
      lines.push(
        f.isBinary
          ? `- \`${f.filename}\`${s.binary}`
          : `- \`${f.filename}\` (+${f.added} / -${f.removed})`
      );
    }
    if (data.files.length > shown.length) {
      lines.push(s.moreFiles(data.files.length - shown.length));
    }
    lines.push("");
    lines.push(s.fileCommitCount(data.files.length, data.commitCount));
  } else {
    lines.push(s.noFileList(data.commitCount));
  }
  lines.push("");

  const commits = (data.commitLog ?? "").split("\n").filter(Boolean);
  if (commits.length > 0) {
    lines.push(s.commitsHeading);
    const shown = commits.slice(0, COMMIT_LIST_NOTE_MAX);
    for (const line of shown) {
      const sp = line.indexOf(" ");
      const sha = sp === -1 ? line : line.slice(0, sp);
      const message = sp === -1 ? "" : line.slice(sp + 1);
      lines.push(`- \`${sha}\` ${message}`);
    }
    if (commits.length > shown.length) {
      lines.push(s.moreCommits(commits.length - shown.length));
    }
    lines.push("");
  }

  lines.push(s.assetsHeading);
  if (data.assets.length > 0) {
    for (const a of data.assets) {
      lines.push(a.description ? `- ${a.filename} — ${a.description}` : `- ${a.filename}`);
    }
  } else {
    lines.push(s.none);
  }
  lines.push("");

  lines.push("---");
  lines.push(`> ${s.task}${data.taskTitle} (\`${data.taskId}\`)`);
  lines.push(`> ${s.project}${data.projectName}`);
  lines.push(`> ${s.generatedAt}${generatedAt}`);

  return lines.join("\n");
}
