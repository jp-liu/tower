// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db BEFORE imports — vi.mock is hoisted but we need the mock available
const mockTx = {
  task: {
    update: vi.fn(),
  },
  taskLabel: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
};

vi.mock("../../db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    taskLabel: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    projectAsset: {
      create: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/actions/task-actions", () => ({
  updateTaskStatus: vi.fn(async (taskId: string, status: string) => ({ id: taskId, status })),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("@/lib/file-utils", () => ({
  stripCacheUuidSuffix: vi.fn((filename: string) => filename.replace(/-[0-9a-f]{8}(\.[^.]+)$/i, "$1")),
  isAssistantCachePath: vi.fn(),
}));

import { db } from "../../db";
import { execFileSync } from "child_process";
import { existsSync, statSync, copyFileSync, mkdirSync } from "fs";
import { stripCacheUuidSuffix, isAssistantCachePath } from "@/lib/file-utils";
import { taskTools } from "../task-tools";

const mockDb = db as {
  task: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  taskLabel: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  projectAsset: {
    create: ReturnType<typeof vi.fn>;
  };
  project: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as ReturnType<typeof vi.fn>;
const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockIsAssistantCachePath = isAssistantCachePath as ReturnType<typeof vi.fn>;
const mockStripCacheUuidSuffix = stripCacheUuidSuffix as ReturnType<typeof vi.fn>;

describe("task-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default $transaction: execute callback with mockTx
    mockDb.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
    mockTx.task.update.mockResolvedValue({});
    mockTx.taskLabel.deleteMany.mockResolvedValue({});
    mockTx.taskLabel.createMany.mockResolvedValue({});
  });

  // ─── list_tasks ──────────────────────────────────────────────────────────

  describe("list_tasks", () => {
    it("calls findMany with projectId and flattens labels", async () => {
      const mockTasks = [
        {
          id: "task1",
          title: "Test Task",
          labels: [
            { label: { id: "label1", name: "Bug", color: "#ff0000" } },
          ],
        },
      ];
      mockDb.task.findMany.mockResolvedValue(mockTasks);

      const result = await taskTools.list_tasks.handler({ projectId: "proj1" });

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj1" },
        })
      );
      expect(result[0].labels).toEqual([{ id: "label1", name: "Bug", color: "#ff0000" }]);
    });

    it("passes status filter to findMany when provided", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await taskTools.list_tasks.handler({ projectId: "proj1", status: "IN_PROGRESS" });

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj1", status: "IN_PROGRESS" },
        })
      );
    });
  });

  // ─── create_task ──────────────────────────────────────────────────────────

  describe("create_task", () => {
    it("creates task with MEDIUM priority and TODO status by default", async () => {
      const createdTask = { id: "task1", title: "My Task", priority: "MEDIUM", status: "TODO" };
      mockDb.task.create.mockResolvedValue(createdTask);

      const result = await taskTools.create_task.handler({
        projectId: "proj1",
        title: "My Task",
        autoStart: false,
      });

      expect(mockDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "My Task",
          projectId: "proj1",
          priority: "MEDIUM",
          status: "TODO",
        }),
      });
      expect(result).toEqual(createdTask);
    });

    it("creates TaskLabel records when labelIds provided", async () => {
      const createdTask = { id: "task1", title: "Labeled Task" };
      mockDb.task.create.mockResolvedValue(createdTask);

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Labeled Task",
        labelIds: ["lbl1", "lbl2"],
        autoStart: false,
      });

      expect(mockDb.taskLabel.createMany).toHaveBeenCalledWith({
        data: [
          { taskId: "task1", labelId: "lbl1" },
          { taskId: "task1", labelId: "lbl2" },
        ],
      });
    });

    it("copies reference files, strips UUID suffix for cache paths, creates ProjectAsset", async () => {
      const createdTask = { id: "task1", title: "With Ref", description: "desc" };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.task.update.mockResolvedValue({ ...createdTask });
      mockDb.projectAsset.create.mockResolvedValue({});

      // existsSync: true for source file, false for dest (no collision)
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/cache/assistant/2026-04/images/design-a1b2c3d4.png") return true; // source exists
        return false; // dest does not exist
      });
      mockStatSync.mockReturnValue({ isFile: () => true, size: 1024 });
      mockIsAssistantCachePath.mockReturnValue(true);
      mockStripCacheUuidSuffix.mockReturnValue("design.png");

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "With Ref",
        references: ["/cache/assistant/2026-04/images/design-a1b2c3d4.png"],
        autoStart: false,
      });

      expect(mockIsAssistantCachePath).toHaveBeenCalledWith("/cache/assistant/2026-04/images/design-a1b2c3d4.png");
      expect(mockStripCacheUuidSuffix).toHaveBeenCalledWith("design-a1b2c3d4.png");
      expect(mockCopyFileSync).toHaveBeenCalled();
      expect(mockDb.projectAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filename: "design.png",
            projectId: "proj1",
            taskId: "task1",
          }),
        })
      );
    });

    it("uses counter suffix for cache file collision", async () => {
      const createdTask = { id: "task1", title: "Collision", description: null };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.task.update.mockResolvedValue({ ...createdTask });
      mockDb.projectAsset.create.mockResolvedValue({});

      mockIsAssistantCachePath.mockReturnValue(true);
      mockStripCacheUuidSuffix.mockReturnValue("design.png");

      // existsSync: source true, dest "design.png" true (collision), "design (1).png" false
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/cache/design-a1b2c3d4.png") return true;
        if (typeof p === "string" && p.endsWith("design.png")) return true;
        if (typeof p === "string" && p.includes("design (1).png")) return false;
        return false;
      });
      mockStatSync.mockReturnValue({ isFile: () => true, size: 512 });

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Collision",
        references: ["/cache/design-a1b2c3d4.png"],
        autoStart: false,
      });

      // Should have used "design (1).png" as the dest filename
      expect(mockCopyFileSync).toHaveBeenCalled();
      const copyCall = mockCopyFileSync.mock.calls[0];
      expect(copyCall[1]).toContain("design (1).png");
    });

    it("auto-detects baseBranch via git when useWorktree=true and no baseBranch given", async () => {
      const createdTask = { id: "task1", title: "Worktree Task" };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.project.findUnique.mockResolvedValue({ localPath: "/home/user/project" });
      mockExecFileSync.mockReturnValue("main\n");

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Worktree Task",
        useWorktree: true,
        autoStart: false,
      });

      expect(mockDb.project.findUnique).toHaveBeenCalledWith({
        where: { id: "proj1" },
        select: { localPath: true },
      });
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["branch", "--show-current"],
        expect.objectContaining({ cwd: "/home/user/project" })
      );
      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ baseBranch: "main" }),
        })
      );
    });

    it("uses provided baseBranch and skips git detection when explicit baseBranch given", async () => {
      const createdTask = { id: "task1", title: "Explicit Branch" };
      mockDb.task.create.mockResolvedValue(createdTask);

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Explicit Branch",
        useWorktree: true,
        baseBranch: "feature/my-branch",
        autoStart: false,
      });

      expect(mockExecFileSync).not.toHaveBeenCalled();
      expect(mockDb.project.findUnique).not.toHaveBeenCalled();
      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ baseBranch: "feature/my-branch" }),
        })
      );
    });

    it("calls fetch to start execution when autoStart=true", async () => {
      const createdTask = { id: "task-autostart-01", title: "AutoStart Task", description: "start me" };
      mockDb.task.create.mockResolvedValue(createdTask);

      const mockFetchResponse = { ok: true, json: vi.fn().mockResolvedValue({ executionId: "exec1" }) };
      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "AutoStart Task",
        description: "start me",
        autoStart: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/internal/terminal/task-autostart-01/start"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("start me"),
        })
      );
    });

    it("does NOT call fetch when autoStart=false", async () => {
      const createdTask = { id: "task2", title: "No Auto" };
      mockDb.task.create.mockResolvedValue(createdTask);
      global.fetch = vi.fn();

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "No Auto",
        autoStart: false,
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ─── update_task ──────────────────────────────────────────────────────────

  describe("update_task", () => {
    it("calls db.task.update with provided fields", async () => {
      const updatedTask = { id: "task1", title: "Updated" };
      mockTx.task.update.mockResolvedValue(updatedTask);

      const result = await taskTools.update_task.handler({
        taskId: "task1",
        title: "Updated",
        priority: "HIGH",
      });

      expect(mockDb.$transaction).toHaveBeenCalled();
      expect(mockTx.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: { title: "Updated", priority: "HIGH" },
      });
      expect(result).toEqual(updatedTask);
    });

    it("deletes existing labels then creates new ones when labelIds provided", async () => {
      const callOrder: string[] = [];
      mockTx.task.update.mockResolvedValue({ id: "task1" });
      mockTx.taskLabel.deleteMany.mockImplementation(() => {
        callOrder.push("deleteMany");
        return Promise.resolve({});
      });
      mockTx.taskLabel.createMany.mockImplementation(() => {
        callOrder.push("createMany");
        return Promise.resolve({});
      });

      await taskTools.update_task.handler({
        taskId: "task1",
        labelIds: ["lbl1", "lbl2"],
      });

      expect(mockTx.taskLabel.deleteMany).toHaveBeenCalledWith({ where: { taskId: "task1" } });
      expect(mockTx.taskLabel.createMany).toHaveBeenCalledWith({
        data: [
          { taskId: "task1", labelId: "lbl1" },
          { taskId: "task1", labelId: "lbl2" },
        ],
      });
      expect(callOrder).toEqual(["deleteMany", "createMany"]);
    });
  });

  // ─── move_task ────────────────────────────────────────────────────────────

  describe("move_task", () => {
    it("delegates to updateTaskStatus", async () => {
      const result = await taskTools.move_task.handler({ taskId: "task1", status: "DONE" });

      const { updateTaskStatus } = await import("@/actions/task-actions");
      expect(updateTaskStatus).toHaveBeenCalledWith("task1", "DONE");
      expect(result).toEqual({ id: "task1", status: "DONE" });
    });
  });

  // ─── delete_task ──────────────────────────────────────────────────────────

  describe("delete_task", () => {
    it("deletes task and returns confirmation", async () => {
      mockDb.task.delete.mockResolvedValue({ id: "task1" });

      const result = await taskTools.delete_task.handler({ taskId: "task1" });

      expect(mockDb.task.delete).toHaveBeenCalledWith({ where: { id: "task1" } });
      expect(result).toEqual({ deleted: true, taskId: "task1" });
    });
  });
});
