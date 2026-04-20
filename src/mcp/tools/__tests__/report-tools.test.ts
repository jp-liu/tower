import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  db: {
    task: { findMany: vi.fn() },
  },
}));

import { db } from "../../db";
import { reportTools } from "../report-tools";

const mockDb = db as {
  task: { findMany: ReturnType<typeof vi.fn> };
};

/** Build a minimal task object matching the daily_summary include clause */
function makeSummaryTask(overrides: {
  id?: string;
  title?: string;
  status?: string;
  priority?: string;
  updatedAt?: Date;
  project?: object;
  messages?: { content: string; createdAt: Date }[];
  executions?: { startedAt?: Date; status?: string; summary?: string | null }[];
}) {
  const now = new Date("2026-01-15T10:00:00Z");
  const ws = { id: "ws1", name: "Workspace 1" };
  const proj = { id: "p1", name: "Project 1", alias: null, workspace: ws };

  return {
    id: overrides.id ?? "task1",
    title: overrides.title ?? "Test task",
    status: overrides.status ?? "TODO",
    priority: overrides.priority ?? "MEDIUM",
    updatedAt: overrides.updatedAt ?? now,
    createdAt: now,
    project: overrides.project ?? proj,
    messages: overrides.messages ?? [],
    executions: overrides.executions ?? [],
    labels: [],
  };
}

/** Build a minimal task object matching the daily_todo include clause */
function makeTodoTask(overrides: {
  id?: string;
  title?: string;
  status?: string;
  priority?: string;
  updatedAt?: Date;
  project?: object;
  labels?: { label: { name: string } }[];
  executions?: { sessionId?: string | null }[];
}) {
  const now = new Date("2026-01-15T10:00:00Z");
  const ws = { id: "ws1", name: "Workspace 1" };
  const proj = { id: "p1", name: "Project 1", alias: null, workspace: ws };

  return {
    id: overrides.id ?? "task1",
    title: overrides.title ?? "Test task",
    status: overrides.status ?? "TODO",
    priority: overrides.priority ?? "MEDIUM",
    updatedAt: overrides.updatedAt ?? now,
    createdAt: now,
    project: overrides.project ?? proj,
    labels: overrides.labels ?? [],
    executions: overrides.executions ?? [],
  };
}

describe("report-tools (MCP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── daily_summary ─────────────────────────────────────────────────────────

  describe("daily_summary", () => {
    it("with date param: uses date range [00:00, next day 00:00) and groups DONE/IN_PROGRESS tasks", async () => {
      const doneTask = makeSummaryTask({ id: "t1", status: "DONE", title: "Done task" });
      const inProgressTask = makeSummaryTask({ id: "t2", status: "IN_PROGRESS", title: "WIP task" });
      mockDb.task.findMany.mockResolvedValue([doneTask, inProgressTask]);

      const result = await reportTools.daily_summary.handler({ date: "2026-01-15" });

      // Verify date range filter passed to findMany
      const callArgs = mockDb.task.findMany.mock.calls[0][0];
      const orClauses = callArgs.where.OR;
      const updatedAtClause = orClauses.find((c: Record<string, unknown>) => "updatedAt" in c);
      expect(updatedAtClause).toBeDefined();
      const gte = updatedAtClause.updatedAt.gte as Date;
      const lt = updatedAtClause.updatedAt.lt as Date;
      expect(gte.getHours()).toBe(0);
      expect(gte.getMinutes()).toBe(0);
      const diffMs = lt.getTime() - gte.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);

      // Verify grouping
      expect(result.workspaces).toHaveLength(1);
      const ws = result.workspaces[0];
      expect(ws.projects).toHaveLength(1);
      const proj = ws.projects[0];
      expect(proj.completed).toHaveLength(1);
      expect(proj.completed[0].id).toBe("t1");
      expect(proj.inProgress).toHaveLength(1);
      expect(proj.inProgress[0].id).toBe("t2");
      expect(result.stats.totalCompleted).toBe(1);
      expect(result.stats.totalInProgress).toBe(1);
    });

    it("without date param: defaults to today (passes Date objects to findMany)", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      const before = new Date();
      before.setHours(0, 0, 0, 0);
      await reportTools.daily_summary.handler({});
      const after = new Date();
      after.setHours(0, 0, 0, 0);

      const callArgs = mockDb.task.findMany.mock.calls[0][0];
      const orClauses = callArgs.where.OR;
      const updatedAtClause = orClauses.find((c: Record<string, unknown>) => "updatedAt" in c);
      const gte = updatedAtClause.updatedAt.gte as Date;
      // gte should be today's midnight (between before and after)
      expect(gte.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(gte.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("CANCELLED tasks are excluded from completed and inProgress", async () => {
      const cancelledTask = makeSummaryTask({ id: "t1", status: "CANCELLED" });
      mockDb.task.findMany.mockResolvedValue([cancelledTask]);

      const result = await reportTools.daily_summary.handler({});

      expect(result.stats.totalCompleted).toBe(0);
      expect(result.stats.totalInProgress).toBe(0);
    });

    it("empty result: returns empty workspaces array with zero stats", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      const result = await reportTools.daily_summary.handler({});

      expect(result.workspaces).toHaveLength(0);
      expect(result.stats.totalCompleted).toBe(0);
      expect(result.stats.totalInProgress).toBe(0);
      expect(result.stats.totalActive).toBe(0);
    });
  });

  // ── daily_todo ────────────────────────────────────────────────────────────

  describe("daily_todo", () => {
    it("default call: status filter is [TODO, IN_PROGRESS, IN_REVIEW]", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await reportTools.daily_todo.handler({});

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] });
    });

    it("with workspaceId: where clause includes project.workspaceId", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await reportTools.daily_todo.handler({ workspaceId: "ws1" });

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.project).toEqual({ workspaceId: "ws1" });
    });

    it("with projectId: where clause includes projectId", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await reportTools.daily_todo.handler({ projectId: "p1" });

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.projectId).toBe("p1");
    });

    it("with priority filter: where clause includes priority.in", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await reportTools.daily_todo.handler({ priority: ["CRITICAL", "HIGH"] });

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.priority).toEqual({ in: ["CRITICAL", "HIGH"] });
    });

    it("stats computation: byStatus and byPriority match returned tasks", async () => {
      const t1 = makeTodoTask({ id: "t1", status: "TODO", priority: "CRITICAL" });
      const t2 = makeTodoTask({ id: "t2", status: "IN_PROGRESS", priority: "HIGH" });
      const t3 = makeTodoTask({ id: "t3", status: "IN_REVIEW", priority: "CRITICAL" });
      mockDb.task.findMany.mockResolvedValue([t1, t2, t3]);

      const result = await reportTools.daily_todo.handler({});

      expect(result.stats.total).toBe(3);
      expect(result.stats.byStatus.TODO).toBe(1);
      expect(result.stats.byStatus.IN_PROGRESS).toBe(1);
      expect(result.stats.byStatus.IN_REVIEW).toBe(1);
      expect(result.stats.byPriority.CRITICAL).toBe(2);
      expect(result.stats.byPriority.HIGH).toBe(1);
      expect(result.stats.byPriority.MEDIUM).toBe(0);
    });
  });
});
