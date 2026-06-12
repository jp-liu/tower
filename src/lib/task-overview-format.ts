/**
 * Pure formatting helpers for task change overviews.
 *
 * Kept free of node/db/AI imports so it can be unit-tested in isolation and
 * reused by `task-overview.ts` (which owns the IO + AI side effects).
 */

import type { DiffFile } from "@/lib/diff-parser";

const FILE_LIST_NOTE_MAX = 100; // files listed in the note body

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

/** Best-effort one-line summary from a git oneline log, used when AI fails. */
export function buildFallbackSummary(commitLog: string | null): string | null {
  if (!commitLog) return null;
  const lines = commitLog.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const first = lines[0].replace(/^[a-f0-9]+\s+/, "");
  return lines.length === 1 ? first : `${lines.length} 个提交：${first}`;
}

/** Note title for an overview. */
export function buildNoteTitle(taskTitle: string, kind: OverviewKind = "done"): string {
  const prefix = kind === "cancelled" ? "任务概览（已取消）：" : "任务概览：";
  return `${prefix}${taskTitle}`.slice(0, 200);
}

/** Render the overview note body (Markdown). */
export function formatNoteContent(
  data: TaskChangeData,
  summary: string | null,
  generatedAt: string,
  kind: OverviewKind = "done"
): string {
  const intro =
    kind === "cancelled"
      ? "> 本笔记由任务取消时自动生成，记录已产生的改动，作为下次重启该任务的参考经验。"
      : "> 本笔记由任务完成时自动生成，记录本次任务的改动概览，便于后续复盘与排查。";
  const lines: string[] = [];
  lines.push(intro);
  lines.push("");

  lines.push("## 改动摘要");
  lines.push(summary ?? "（未能生成改动摘要）");
  lines.push("");

  lines.push("## 文件清单");
  if (data.files.length > 0) {
    const shown = data.files.slice(0, FILE_LIST_NOTE_MAX);
    for (const f of shown) {
      lines.push(
        f.isBinary
          ? `- \`${f.filename}\`（二进制）`
          : `- \`${f.filename}\` (+${f.added} / -${f.removed})`
      );
    }
    if (data.files.length > shown.length) {
      lines.push(`- …其余 ${data.files.length - shown.length} 个文件`);
    }
    lines.push("");
    lines.push(`共 ${data.files.length} 个文件、${data.commitCount} 个提交。`);
  } else {
    lines.push(`（未能获取精确文件清单，本次约 ${data.commitCount} 个提交。）`);
  }
  lines.push("");

  lines.push("## 相关附件与参考资料");
  if (data.assets.length > 0) {
    for (const a of data.assets) {
      lines.push(a.description ? `- ${a.filename} — ${a.description}` : `- ${a.filename}`);
    }
  } else {
    lines.push("（无）");
  }
  lines.push("");

  lines.push("---");
  lines.push(`> 关联任务：${data.taskTitle} (\`${data.taskId}\`)`);
  lines.push(`> 项目：${data.projectName}`);
  lines.push(`> 生成时间：${generatedAt}`);

  return lines.join("\n");
}
