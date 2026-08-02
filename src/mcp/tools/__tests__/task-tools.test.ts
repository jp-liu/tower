// @vitest-environment node
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock db BEFORE imports — vi.mock is hoisted but we need the mock available
const mockTx = {
  task: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  version: {
    findFirst: vi.fn(),
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
      findUnique: vi.fn(),
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
    unattendedGoalRuntime: {
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
}));

vi.mock("@/lib/file-utils", () => ({
  stripCacheUuidSuffix: vi.fn((filename: string) => filename.replace(/-[0-9a-f]{8}(\.[^.]+)$/i, "$1")),
  isAssistantCachePath: vi.fn(),
  guessMimeType: vi.fn(() => "image/png"),
  ensureAssetsDir: vi.fn(() => "/mock/.tower/storage/assets/proj1"),
}));

import { db } from "../../db";
import { execFileSync } from "child_process";
import { existsSync, statSync, copyFileSync } from "fs";
import { stripCacheUuidSuffix, isAssistantCachePath, ensureAssetsDir } from "@/lib/file-utils";
import { taskTools } from "../task-tools";

const mockDb = db as unknown as {
  task: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
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
  unattendedGoalRuntime: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as ReturnType<typeof vi.fn>;
const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>;
const mockEnsureAssetsDir = ensureAssetsDir as ReturnType<typeof vi.fn>;
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
    mockDb.unattendedGoalRuntime.findUnique.mockResolvedValue(null);
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
          where: {
            projectId: "proj1",
            NOT: { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
          },
        })
      );
      expect(result[0].labels).toEqual([{ id: "label1", name: "Bug", color: "#ff0000" }]);
    });

    it("passes status filter to findMany when provided", async () => {
      mockDb.task.findMany.mockResolvedValue([]);

      await taskTools.list_tasks.handler({ projectId: "proj1", status: "IN_PROGRESS" });

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: "proj1",
            status: "IN_PROGRESS",
            NOT: { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
          },
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
      expect(result).toMatchObject(createdTask);
    });

    it("returns a ready-to-show display card rendered from the tower skill template", async () => {
      const createdTask = {
        id: "task1",
        title: "My Task",
        priority: "HIGH",
        status: "TODO",
        description: "## 目标\n修复角色切换后的权限提示。\n\n## 需求\n- 复现问题",
      };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.project.findUnique.mockResolvedValue({ name: "南京招生报名", alias: "enrollment-static", localPath: null });

      const result = (await taskTools.create_task.handler({
        projectId: "proj1",
        title: "My Task",
        description: "## 目标\n修复角色切换后的权限提示。\n\n## 需求\n- 复现问题",
        priority: "HIGH",
        useWorktree: false,
        autoStart: false,
      })) as { display?: string };

      expect(result.display).toContain("✅ 已为您创建任务：**My Task**");
      expect(result.display).toContain("📋 **任务详情：**");
      expect(result.display).toContain("- 项目：南京招生报名 (enrollment-static)");
      expect(result.display).toContain("- 优先级：🟠 高");
      expect(result.display).toContain("- 状态：待开始");
      expect(result.display).toContain("- 工作区：直接在项目目录执行");
      expect(result.display).toContain("- 任务 ID：task1");
      expect(result.display).toContain("🎯 **任务目标：**");
      expect(result.display).toContain("修复角色切换后的权限提示。");
      expect(result.display).toContain("✅ **已准备就绪：**");
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

    it("records repository files as relative paths instead of uploading them as assets", async () => {
      mockDb.project.findUnique.mockResolvedValue({
        name: "Project",
        alias: null,
        localPath: "/home/user/project",
      });
      mockDb.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "task1",
        ...data,
      }));

      const result = await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Code references",
        description: "## 目标\n修复问题\n\n## 参考\n\n## 来源\n\n无",
        references: [
          "/home/user/project/src/backend.ts",
          "/home/user/project/src/components/TwinDialogs.vue",
        ],
        useWorktree: false,
        autoStart: false,
      }) as { projectFileReferences?: string[]; display?: string };

      expect(mockEnsureAssetsDir).not.toHaveBeenCalled();
      expect(mockCopyFileSync).not.toHaveBeenCalled();
      expect(mockDb.projectAsset.create).not.toHaveBeenCalled();
      expect(mockDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: expect.stringContaining("- 项目文件：`src/backend.ts`"),
        }),
      });
      const storedDescription = mockDb.task.create.mock.calls[0][0].data.description as string;
      expect(storedDescription).toContain("- 项目文件：`src/components/TwinDialogs.vue`");
      expect(storedDescription.indexOf("## 参考")).toBeLessThan(storedDescription.indexOf("## 来源"));
      expect(result.projectFileReferences).toEqual([
        "src/backend.ts",
        "src/components/TwinDialogs.vue",
      ]);
      expect(result.display).toContain("已记录项目文件：src/backend.ts, src/components/TwinDialogs.vue");
    });

    it("resolves relative repository references without uploading them", async () => {
      mockDb.project.findUnique.mockResolvedValue({
        name: "Project",
        alias: null,
        localPath: "/home/user/project",
      });
      mockDb.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "task1",
        ...data,
      }));

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Relative code reference",
        description: "## 目标\n修复问题\n\n## 来源\n\n无",
        references: ["src/index.ts"],
        useWorktree: false,
        autoStart: false,
      });

      expect(mockEnsureAssetsDir).not.toHaveBeenCalled();
      expect(mockDb.projectAsset.create).not.toHaveBeenCalled();
      expect(mockDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: expect.stringContaining("## 参考\n\n- 项目文件：`src/index.ts`"),
        }),
      });
    });

    it("blocks source files outside the project from becoming assets", async () => {
      mockDb.project.findUnique.mockResolvedValue({
        name: "Project",
        alias: null,
        localPath: "/home/user/project",
      });
      mockDb.task.create.mockResolvedValue({ id: "task1", title: "External code", priority: "MEDIUM", status: "TODO" });
      mockExecFileSync.mockImplementation(() => {
        throw new Error("not a git repository");
      });

      const result = await taskTools.create_task.handler({
        projectId: "proj1",
        title: "External code",
        references: ["/tmp/generated/backend.ts"],
        useWorktree: false,
        autoStart: false,
      }) as { skippedReferences?: { reference: string; reason: string }[] };

      expect(mockEnsureAssetsDir).not.toHaveBeenCalled();
      expect(mockCopyFileSync).not.toHaveBeenCalled();
      expect(mockDb.projectAsset.create).not.toHaveBeenCalled();
      expect(result.skippedReferences).toEqual([
        expect.objectContaining({ reference: "/tmp/generated/backend.ts" }),
      ]);
    });

    it("converts source paths from a git worktree to repository-relative references", async () => {
      mockDb.project.findUnique.mockResolvedValue({
        name: "Project",
        alias: null,
        localPath: "/home/user/project",
      });
      mockDb.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "task1",
        ...data,
      }));
      mockExecFileSync.mockReturnValue("/tmp/tower-worktree\n");

      const result = await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Worktree code reference",
        description: "## 目标\n修复问题\n\n## 来源\n\n无",
        references: ["/tmp/tower-worktree/src/backend.ts"],
        useWorktree: false,
        autoStart: false,
      }) as { projectFileReferences?: string[] };

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--show-toplevel"],
        expect.objectContaining({ cwd: "/tmp/tower-worktree/src" }),
      );
      expect(mockEnsureAssetsDir).not.toHaveBeenCalled();
      expect(mockDb.projectAsset.create).not.toHaveBeenCalled();
      expect(result.projectFileReferences).toEqual(["src/backend.ts"]);
      expect(mockDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: expect.stringContaining("- 项目文件：`src/backend.ts`"),
        }),
      });
    });

    it("resolves the assets dir via ensureAssetsDir (Tower storage root), not a cwd/install-relative path", async () => {
      const createdTask = { id: "task1", title: "With Ref", description: "desc" };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.task.update.mockResolvedValue({ ...createdTask });
      mockDb.projectAsset.create.mockResolvedValue({});
      mockEnsureAssetsDir.mockReturnValue("/mock/.tower/storage/assets/proj1");

      mockExistsSync.mockImplementation((p: string) => p === "/tmp/ref.png");
      mockStatSync.mockReturnValue({ isFile: () => true, size: 1024 });
      mockIsAssistantCachePath.mockReturnValue(false);

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "With Ref",
        references: ["/tmp/ref.png"],
        autoStart: false,
      });

      expect(mockEnsureAssetsDir).toHaveBeenCalledWith("proj1");
      // Destination must live under the resolved storage root, never under
      // an install/cwd-relative "data/assets" path.
      const dest = mockCopyFileSync.mock.calls[0][1] as string;
      expect(dest).toContain("/mock/.tower/storage/assets/proj1");
      expect(dest).not.toContain("data/assets");
    });

    it("still uploads user attachment types even when their path is inside the project", async () => {
      const createdTask = { id: "task1", title: "Project Screenshot", description: "desc" };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.task.update.mockResolvedValue({ ...createdTask });
      mockDb.projectAsset.create.mockResolvedValue({});
      mockDb.project.findUnique.mockResolvedValue({
        name: "Project",
        alias: null,
        localPath: "/home/user/project",
      });
      mockExistsSync.mockImplementation((p: string) => p === "/home/user/project/screenshots/issue.png");
      mockStatSync.mockReturnValue({ isFile: () => true, size: 1024 });
      mockIsAssistantCachePath.mockReturnValue(false);

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Project Screenshot",
        references: ["/home/user/project/screenshots/issue.png"],
        useWorktree: false,
        autoStart: false,
      });

      expect(mockCopyFileSync).toHaveBeenCalledWith(
        "/home/user/project/screenshots/issue.png",
        expect.stringContaining("/mock/.tower/storage/assets/proj1/issue.png"),
      );
      expect(mockDb.projectAsset.create).toHaveBeenCalled();
    });

    it("attaches an explicit local media path found in the description", async () => {
      const createdTask = { id: "task1", title: "With Image", description: "## 参考\n- 页面截图" };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.task.update.mockResolvedValue({ ...createdTask });
      mockDb.projectAsset.create.mockResolvedValue({});

      const imagePath = "/Users/me/.openclaw/media/inbound/shot.jpg";
      mockExistsSync.mockImplementation((p: string) => p === imagePath);
      mockStatSync.mockImplementation((p: string) => ({
        isFile: () => p === imagePath,
        size: 2048,
      }));
      mockIsAssistantCachePath.mockReturnValue(false);

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "With Image",
        description: `## 目标\n修复截图中的问题\n\n## 参考\n- 页面截图：${imagePath}`,
        autoStart: false,
      });

      expect(mockCopyFileSync).toHaveBeenCalledWith(
        imagePath,
        expect.stringContaining("/mock/.tower/storage/assets/proj1/shot.jpg"),
      );
      expect(mockDb.projectAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filename: "shot.jpg",
            taskId: "task1",
          }),
        }),
      );
    });

    it("surfaces a failure (not a silent skip) when copying a reference throws", async () => {
      const createdTask = { id: "task1", title: "Bad Ref", description: null };
      mockDb.task.create.mockResolvedValue(createdTask);
      mockDb.task.update.mockResolvedValue({ ...createdTask });
      mockEnsureAssetsDir.mockReturnValue("/mock/.tower/storage/assets/proj1");

      mockExistsSync.mockImplementation((p: string) => p === "/tmp/ref.png");
      mockStatSync.mockReturnValue({ isFile: () => true, size: 1024 });
      mockIsAssistantCachePath.mockReturnValue(false);
      mockCopyFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Bad Ref",
        references: ["/tmp/ref.png"],
        autoStart: false,
      }) as { attachmentFailures?: { reference: string; error: string }[] };

      expect(result.attachmentFailures).toBeDefined();
      expect(result.attachmentFailures).toHaveLength(1);
      expect(result.attachmentFailures![0].reference).toBe("/tmp/ref.png");
      expect(result.attachmentFailures![0].error).toContain("EACCES");
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
      mockDb.project.findUnique.mockResolvedValue({ name: "P", alias: null, localPath: "/home/user/project" });
      mockExecFileSync.mockReturnValue("main\n");

      await taskTools.create_task.handler({
        projectId: "proj1",
        title: "Worktree Task",
        useWorktree: true,
        autoStart: false,
      });

      expect(mockDb.project.findUnique).toHaveBeenCalledWith({
        where: { id: "proj1" },
        select: { name: true, alias: true, localPath: true },
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

      // Explicit baseBranch → no git detection. project.findUnique is still
      // called (project meta feeds the display card), but execFileSync is not.
      expect(mockExecFileSync).not.toHaveBeenCalled();
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

      const result = await taskTools.create_task.handler({
        projectId: "proj1",
        title: "AutoStart Task",
        description: "start me",
        autoStart: true,
      }) as {
        handoff?: { mode: string; shouldPoll: boolean; instruction: string };
        display?: string;
      };

      // Prompt is the task title — startPtyExecution injects the description as context separately.
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/internal/terminal/task-autostart-01/start"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("AutoStart Task"),
        })
      );
      expect(result.handoff).toEqual({
        mode: "callback",
        shouldPoll: false,
        instruction: "End this turn and wait for Tower's child-completion callback.",
      });
      expect(result.display).toContain("无需主动轮询子任务");
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

    // ─── parent task binding + server-side source（硬规则：handler 保证 ## 来源）──
    describe("parent task binding & source", () => {
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("binds parentTaskId when TOWER_TASK_ID resolves to an existing task", async () => {
        vi.stubEnv("TOWER_TASK_ID", "parent-1");
        mockDb.task.findUnique.mockResolvedValue({ id: "parent-1", title: "父" });
        mockDb.task.create.mockResolvedValue({ id: "t1", title: "T" });
        await taskTools.create_task.handler({ projectId: "p1", title: "T", autoStart: false });
        expect(mockDb.task.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ parentTaskId: "parent-1" }),
        });
      });

      it("appends the parent-derivation source when derived from a parent task", async () => {
        vi.stubEnv("TOWER_TASK_ID", "parent-1");
        mockDb.task.findUnique.mockResolvedValue({ id: "parent-1", title: "父任务标题" });
        mockDb.task.create.mockResolvedValue({ id: "t1", title: "T" });
        await taskTools.create_task.handler({ projectId: "p1", title: "T", description: "## 目标\nx", autoStart: false });
        const call = mockDb.task.create.mock.calls[0][0] as { data: { description?: string } };
        expect(call.data.description).toContain("- 渠道：父任务派生");
        expect(call.data.description).toContain("- 父任务：父任务标题（id: parent-1）");
      });

      it("leaves parentTaskId null when there is no TOWER_TASK_ID", async () => {
        vi.stubEnv("TOWER_TASK_ID", "");
        mockDb.task.create.mockResolvedValue({ id: "t1", title: "T" });
        await taskTools.create_task.handler({ projectId: "p1", title: "T", autoStart: false });
        const call = mockDb.task.create.mock.calls[0][0] as { data: { parentTaskId: string | null } };
        expect(call.data.parentTaskId).toBeNull();
      });

      it("silently appends `## 来源\\n无` when a described task has no source (never rejects)", async () => {
        vi.stubEnv("TOWER_TASK_ID", "");
        mockDb.task.create.mockResolvedValue({ id: "t1", title: "T" });
        await taskTools.create_task.handler({ projectId: "p1", title: "T", description: "原始需求", autoStart: false });
        const call = mockDb.task.create.mock.calls[0][0] as { data: { description?: string } };
        expect(call.data.description).toBe("原始需求\n\n## 来源\n\n无");
      });

      it("strips a raw <task-source> block from the stored description", async () => {
        vi.stubEnv("TOWER_TASK_ID", "");
        mockDb.task.create.mockResolvedValue({ id: "t1", title: "T" });
        const desc = "## 目标\nx\n\n<task-source>\nchannel: feishu\nchat_name: 招生群\nchat_id: oc_1\n</task-source>";
        await taskTools.create_task.handler({ projectId: "p1", title: "T", description: desc, autoStart: false });
        const call = mockDb.task.create.mock.calls[0][0] as { data: { description?: string } };
        expect(call.data.description).not.toContain("<task-source>");
        expect(call.data.description).toContain("- 渠道：飞书群「招生群」");
      });
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

    it("normalizes description source on update — strips <task-source>, renders 来源", async () => {
      mockTx.task.findUnique.mockResolvedValue(null); // no parent
      mockTx.task.update.mockResolvedValue({ id: "task1" });

      await taskTools.update_task.handler({
        taskId: "task1",
        description: "## 目标\nx\n\n<task-source>\nchannel: wechat\nchat_id: oc_5\n</task-source>",
      });

      const data = (mockTx.task.update.mock.calls[0][0] as { data: { description: string } }).data;
      expect(data.description).not.toContain("<task-source>");
      expect(data.description).toContain("- 渠道：微信群");
      expect(data.description).toContain("chat=oc_5");
    });

    it("guarantees a trailing 来源 on update when description omits it", async () => {
      mockTx.task.findUnique.mockResolvedValue(null);
      mockTx.task.update.mockResolvedValue({ id: "task1" });

      await taskTools.update_task.handler({ taskId: "task1", description: "## 目标\n只改目标" });

      const data = (mockTx.task.update.mock.calls[0][0] as { data: { description: string } }).data;
      expect(data.description).toContain("## 来源");
      expect(data.description.trimEnd().endsWith("无")).toBe(true);
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

    it("assigns versionId after validating it belongs to the task's project", async () => {
      mockTx.task.findUnique.mockResolvedValue({ projectId: "proj1" });
      mockTx.version.findFirst.mockResolvedValue({ id: "ver1" });
      mockTx.task.update.mockResolvedValue({ id: "task1", versionId: "ver1" });

      await taskTools.update_task.handler({ taskId: "task1", versionId: "ver1" });

      expect(mockTx.version.findFirst).toHaveBeenCalledWith({
        where: { id: "ver1", projectId: "proj1" },
        select: { id: true },
      });
      expect(mockTx.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: { versionId: "ver1" },
      });
    });

    it("clears versionId (moves to backlog) when null is passed", async () => {
      mockTx.task.update.mockResolvedValue({ id: "task1", versionId: null });

      await taskTools.update_task.handler({ taskId: "task1", versionId: null });

      // No project/version lookup needed when clearing
      expect(mockTx.task.findUnique).not.toHaveBeenCalled();
      expect(mockTx.version.findFirst).not.toHaveBeenCalled();
      expect(mockTx.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: { versionId: null },
      });
    });

    it("clears versionId when an empty string is passed", async () => {
      mockTx.task.update.mockResolvedValue({ id: "task1", versionId: null });

      await taskTools.update_task.handler({ taskId: "task1", versionId: "" });

      expect(mockTx.version.findFirst).not.toHaveBeenCalled();
      expect(mockTx.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: { versionId: null },
      });
    });

    it("falls back to backlog when versionId belongs to a different project", async () => {
      mockTx.task.findUnique.mockResolvedValue({ projectId: "proj1" });
      mockTx.version.findFirst.mockResolvedValue(null); // mismatch
      mockTx.task.update.mockResolvedValue({ id: "task1", versionId: null });

      await taskTools.update_task.handler({ taskId: "task1", versionId: "ver-other" });

      expect(mockTx.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: { versionId: null },
      });
    });

    it("leaves versionId untouched when not provided", async () => {
      mockTx.task.update.mockResolvedValue({ id: "task1", title: "Renamed" });

      await taskTools.update_task.handler({ taskId: "task1", title: "Renamed" });

      expect(mockTx.version.findFirst).not.toHaveBeenCalled();
      expect(mockTx.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: { title: "Renamed" },
      });
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
