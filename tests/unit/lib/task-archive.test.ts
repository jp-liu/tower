// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ARCHIVE_DELAY_DAYS,
  MIN_ARCHIVE_DELAY_DAYS,
  MAX_ARCHIVE_DELAY_DAYS,
  normalizeArchiveDelayDays,
  visibleTaskWhere,
  archivedTaskWhere,
} from "@/lib/task-archive";

// 本地午夜，避免时区抖动
function startOfDay(y: number, m: number, d: number): Date {
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// 固定参照时间：2026-06-12 15:30（当天非午夜，验证会归一到午夜）
const NOW = new Date(2026, 5, 12, 15, 30, 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
const branch = (where: any, status: string) =>
  (where.OR as any[]).find((b) => b.status === status);

describe("normalizeArchiveDelayDays", () => {
  it("keeps valid integers", () => {
    expect(normalizeArchiveDelayDays(7)).toBe(7);
    expect(normalizeArchiveDelayDays(1)).toBe(1);
    expect(normalizeArchiveDelayDays(30)).toBe(30);
  });
  it("coerces numeric strings", () => {
    expect(normalizeArchiveDelayDays("7")).toBe(7);
  });
  it("floors fractions", () => {
    expect(normalizeArchiveDelayDays(3.9)).toBe(3);
  });
  it("clamps values below the minimum (1) — no immediate archive", () => {
    expect(normalizeArchiveDelayDays(0)).toBe(MIN_ARCHIVE_DELAY_DAYS);
    expect(normalizeArchiveDelayDays(-5)).toBe(MIN_ARCHIVE_DELAY_DAYS);
  });
  it("falls back to default on non-numeric input", () => {
    expect(normalizeArchiveDelayDays(NaN)).toBe(DEFAULT_ARCHIVE_DELAY_DAYS);
    expect(normalizeArchiveDelayDays(undefined)).toBe(DEFAULT_ARCHIVE_DELAY_DAYS);
    expect(normalizeArchiveDelayDays("abc")).toBe(DEFAULT_ARCHIVE_DELAY_DAYS);
  });
  it("clamps to the max", () => {
    expect(normalizeArchiveDelayDays(99999)).toBe(MAX_ARCHIVE_DELAY_DAYS);
  });
});

describe("visibleTaskWhere", () => {
  it("always shows active (non-terminal) tasks", () => {
    const w = visibleTaskWhere(7, NOW) as any;
    expect(w.OR[0]).toEqual({ status: { notIn: ["DONE", "CANCELLED"] } });
  });

  it("N=1 reproduces the legacy boundary (Done visible only on its done-day)", () => {
    const w = visibleTaskWhere(1, NOW);
    // doneCutoff == startOfToday
    expect(branch(w, "DONE").doneAt.gte).toEqual(startOfDay(2026, 6, 12));
  });

  it("N=7 keeps Done visible for 7 calendar days", () => {
    const w = visibleTaskWhere(7, NOW);
    // doneCutoff == startOfToday - 6 days
    expect(branch(w, "DONE").doneAt.gte).toEqual(startOfDay(2026, 6, 6));
  });

  it("Cancelled keeps the next-day rule based on updatedAt (independent of N)", () => {
    const w7 = visibleTaskWhere(7, NOW);
    const w1 = visibleTaskWhere(1, NOW);
    expect(branch(w7, "CANCELLED").updatedAt.gte).toEqual(startOfDay(2026, 6, 12));
    expect(branch(w1, "CANCELLED").updatedAt.gte).toEqual(startOfDay(2026, 6, 12));
  });
});

describe("archivedTaskWhere", () => {
  it("restricts to terminal states", () => {
    const w = archivedTaskWhere(7, NOW) as any;
    expect(w.status).toEqual({ in: ["DONE", "CANCELLED"] });
  });

  it("treats legacy Done tasks without doneAt as archived", () => {
    const w = archivedTaskWhere(7, NOW) as any;
    const nullBranch = (w.OR as any[]).find(
      (b) => b.status === "DONE" && b.doneAt === null
    );
    expect(nullBranch).toBeTruthy();
  });

  it("is the exact complement of visibleTaskWhere for Done (same cutoff, lt vs gte)", () => {
    const visible = visibleTaskWhere(7, NOW);
    const archived = archivedTaskWhere(7, NOW) as any;
    const visGte = branch(visible, "DONE").doneAt.gte;
    const archLt = (archived.OR as any[]).find(
      (b) => b.status === "DONE" && b.doneAt?.lt
    ).doneAt.lt;
    expect(archLt).toEqual(visGte);
  });

  it("Cancelled archived branch mirrors the visible boundary (lt vs gte)", () => {
    const archived = archivedTaskWhere(7, NOW) as any;
    const cancelled = (archived.OR as any[]).find(
      (b) => b.status === "CANCELLED"
    );
    expect(cancelled.updatedAt.lt).toEqual(startOfDay(2026, 6, 12));
  });
});
