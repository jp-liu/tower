import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    task: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { getDailySummary, getDailyTodo } from "@/actions/report-actions";

const mockDb = db as {
  task: { findMany: ReturnType<typeof vi.fn> };
};

/** Build a minimal task object that matches the include clause used by getDailySummary */
function makeTask(overrides: {
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

/** Build a minimal task object that matches the include clause used by getDailyTodo */
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

describe("report-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getDailySummary ───────────────────────────────────────────────────────

  describe("getDailySummary", () => {
    it("happy path: groups DONE and IN_PROGRESS tasks into workspaces", async () => {
      const doneTask = makeTask({ id: "t1", status: "DONE", title: "Done task" });
      const inProgressTask = makeTask({ id: "t2", status: "IN_PROGRESS", title: "WIP task" });
      mockDb.task.findMany.mockResolvedValue([doneTask, inProgressTask]);

      const result = await getDailySummary();

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

    it("empty day: returns empty workspaces and zero stats", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      const result = await getDailySummary();

      expect(result.workspaces).toHaveLength(0);
      expect(result.stats.totalCompleted).toBe(0);
      expect(result.stats.totalInProgress).toBe(0);
      expect(result.stats.totalActive).toBe(0);
    });

    it("custom date: date range filter spans the specified day (24h window)", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await getDailySummary("2026-01-15");

      const callArgs = mockDb.task.findMany.mock.calls[0][0];
      const orClauses = callArgs.where.OR;
      // The updatedAt clause should use gte/lt covering exactly 24 hours
      const updatedAtClause = orClauses.find((c: Record<string, unknown>) => "updatedAt" in c);
      expect(updatedAtClause).toBeDefined();
      const gte = updatedAtClause.updatedAt.gte as Date;
      const lt = updatedAtClause.updatedAt.lt as Date;
      // gte should be midnight local time for 2026-01-15
      expect(gte.getHours()).toBe(0);
      expect(gte.getMinutes()).toBe(0);
      // lt should be exactly 24 hours after gte
      const diffMs = lt.getTime() - gte.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
    });

    it("CANCELLED tasks are excluded from completed and inProgress", async () => {
      const cancelledTask = makeTask({ id: "t1", status: "CANCELLED" });
      mockDb.task.findMany.mockResolvedValue([cancelledTask]);

      const result = await getDailySummary();

      expect(result.stats.totalCompleted).toBe(0);
      expect(result.stats.totalInProgress).toBe(0);
      // workspace may or may not be present but counts are 0
    });

    it("uses execution summary as progressSummary when available", async () => {
      const task = makeTask({
        status: "IN_PROGRESS",
        executions: [{ summary: "Execution progress summary" }],
        messages: [],
      });
      mockDb.task.findMany.mockResolvedValue([task]);

      const result = await getDailySummary();

      const inProgressTask = result.workspaces[0].projects[0].inProgress[0];
      expect(inProgressTask.progressSummary).toBe("Execution progress summary");
    });

    it("falls back to message content (truncated at 200 chars) when no execution summary", async () => {
      const longContent = "A".repeat(300);
      const now = new Date();
      const task = makeTask({
        status: "IN_PROGRESS",
        executions: [{ summary: null }],
        messages: [{ content: longContent, createdAt: now }],
      });
      mockDb.task.findMany.mockResolvedValue([task]);

      const result = await getDailySummary();

      const inProgressTask = result.workspaces[0].projects[0].inProgress[0];
      expect(inProgressTask.progressSummary).toHaveLength(203); // 200 chars + "..."
      expect(inProgressTask.progressSummary).toMatch(/\.\.\.$/);
    });
  });

  // ── getDailyTodo ──────────────────────────────────────────────────────────

  describe("getDailyTodo", () => {
    it("happy path: tasks sorted by priority (CRITICAL first)", async () => {
      const lowTask = makeTodoTask({ id: "t3", priority: "LOW", title: "Low priority" });
      const criticalTask = makeTodoTask({ id: "t1", priority: "CRITICAL", title: "Critical task" });
      const highTask = makeTodoTask({ id: "t2", priority: "HIGH", title: "High priority" });
      // findMany returns in arbitrary order — sort happens in the action
      mockDb.task.findMany.mockResolvedValue([lowTask, criticalTask, highTask]);

      const result = await getDailyTodo();

      // All tasks end up in the workspace/project structure
      const tasks = result.workspaces[0].projects[0].tasks;
      expect(tasks[0].priority).toBe("CRITICAL");
      expect(tasks[1].priority).toBe("HIGH");
      expect(tasks[2].priority).toBe("LOW");
    });

    it("filter by workspaceId: where clause includes project.workspaceId", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await getDailyTodo({ workspaceId: "ws1" });

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.project).toEqual({ workspaceId: "ws1" });
    });

    it("filter by projectId: where clause includes projectId", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await getDailyTodo({ projectId: "p1" });

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.projectId).toBe("p1");
    });

    it("filter by priority: where clause includes priority.in", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await getDailyTodo({ priority: ["CRITICAL", "HIGH"] });

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.priority).toEqual({ in: ["CRITICAL", "HIGH"] });
    });

    it("stats breakdown: byStatus and byPriority match mocked data", async () => {
      const t1 = makeTodoTask({ id: "t1", status: "TODO", priority: "CRITICAL" });
      const t2 = makeTodoTask({ id: "t2", status: "IN_PROGRESS", priority: "HIGH" });
      const t3 = makeTodoTask({ id: "t3", status: "IN_REVIEW", priority: "CRITICAL" });
      mockDb.task.findMany.mockResolvedValue([t1, t2, t3]);

      const result = await getDailyTodo();

      expect(result.stats.total).toBe(3);
      expect(result.stats.byStatus.TODO).toBe(1);
      expect(result.stats.byStatus.IN_PROGRESS).toBe(1);
      expect(result.stats.byStatus.IN_REVIEW).toBe(1);
      expect(result.stats.byPriority.CRITICAL).toBe(2);
      expect(result.stats.byPriority.HIGH).toBe(1);
      expect(result.stats.byPriority.MEDIUM).toBe(0);
    });

    it("default status filter: includes TODO, IN_PROGRESS, IN_REVIEW when no filters provided", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await getDailyTodo();

      const where = mockDb.task.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] });
    });
  });
});
