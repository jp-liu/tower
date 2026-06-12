import type { Prisma } from "@prisma/client";

/**
 * 「归档期限」逻辑的单一事实来源。
 *
 * 规则（自然日计数）：
 * - DONE：进入 DONE 当天为第 1 天，保留 N 个自然日；超期后归档。
 *   N 最小为 1：N=1 完全复现旧行为（当天可见，次日归档），不存在「拖到 Done 立刻消失」。
 *   以 `doneAt` 时间戳为基准——编辑已完成任务不会重置归档倒计时。
 * - CANCELLED：保持旧行为不变（次日归档，以 `updatedAt` 为基准）。
 * - 历史 DONE 任务（无 `doneAt`）一律视为已归档。
 */

export const ARCHIVE_DELAY_KEY = "board.archiveDelayDays";
export const DEFAULT_ARCHIVE_DELAY_DAYS = 7;
export const MIN_ARCHIVE_DELAY_DAYS = 1;
export const MAX_ARCHIVE_DELAY_DAYS = 365;

/** 将任意配置值规整为 [1, 365] 的整数；非数字回退默认 7，越界则夹到边界。 */
export function normalizeArchiveDelayDays(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_ARCHIVE_DELAY_DAYS;
  return Math.min(Math.max(n, MIN_ARCHIVE_DELAY_DAYS), MAX_ARCHIVE_DELAY_DAYS);
}

function computeCutoffs(days: number, now: Date) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  // 进入 DONE 当天算第 1 天，因此可见窗口起点回退 (days - 1) 天。
  const doneCutoff = new Date(startOfToday);
  doneCutoff.setDate(doneCutoff.getDate() - (days - 1));
  return { startOfToday, doneCutoff };
}

/** 仍应显示在看板上的任务（活跃 + 未超期的终态任务）。 */
export function visibleTaskWhere(days: number, now: Date = new Date()): Prisma.TaskWhereInput {
  const { startOfToday, doneCutoff } = computeCutoffs(days, now);
  return {
    OR: [
      { status: { notIn: ["DONE", "CANCELLED"] } },
      // Cancelled 保持旧的次日归档行为。
      { status: "CANCELLED", updatedAt: { gte: startOfToday } },
      // Done 进入终态后保留 N 个自然日。
      { status: "DONE", doneAt: { gte: doneCutoff } },
    ],
  };
}

/** 已归档的任务（`visibleTaskWhere` 在终态范围内的精确补集）。 */
export function archivedTaskWhere(days: number, now: Date = new Date()): Prisma.TaskWhereInput {
  const { startOfToday, doneCutoff } = computeCutoffs(days, now);
  return {
    status: { in: ["DONE", "CANCELLED"] },
    OR: [
      { status: "CANCELLED", updatedAt: { lt: startOfToday } },
      { status: "DONE", doneAt: { lt: doneCutoff } },
      // 历史 DONE 任务无 doneAt，视为已归档。
      { status: "DONE", doneAt: null },
    ],
  };
}
