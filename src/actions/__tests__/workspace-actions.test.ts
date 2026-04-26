import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    project: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/instrumentation-tasks", () => ({
  ensureTowerTask: vi.fn().mockResolvedValue("mock-task-id"),
  ensureTowerLabel: vi.fn().mockResolvedValue("mock-label-id"),
}));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  getWorkspacesWithProjects,
  getWorkspaceById,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  createProject,
  getWorkspacesWithRecentTasks,
} from "@/actions/workspace-actions";

const mockDb = db as unknown as {
  workspace: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  project: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

describe("workspace-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWorkspacesWithProjects", () => {
    it("returns array with projects sub-array ordered by updatedAt desc", async () => {
      const mockData = [
        { id: "ws1", name: "Workspace 1", projects: [{ id: "p1", name: "Project 1", alias: null }] },
      ];
      mockDb.workspace.findMany.mockResolvedValue(mockData);

      const result = await getWorkspacesWithProjects();

      expect(result).toEqual(mockData);
      expect(mockDb.workspace.findMany).toHaveBeenCalledOnce();
      const callArgs = mockDb.workspace.findMany.mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ updatedAt: "desc" });
      expect(callArgs.select.projects).toBeDefined();
    });
  });

  describe("getWorkspaceById", () => {
    it("returns workspace with nested projects and tasks", async () => {
      const mockWorkspace = {
        id: "ws1",
        name: "Workspace 1",
        projects: [
          {
            id: "p1",
            name: "Project 1",
            tasks: [{ id: "t1", title: "Task 1" }],
            repositories: [],
          },
        ],
      };
      mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceById("ws1");

      expect(result).toEqual(mockWorkspace);
      expect(mockDb.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: "ws1" },
        include: expect.objectContaining({
          projects: expect.objectContaining({ include: expect.any(Object) }),
        }),
      });
    });

    it("returns null when workspace not found", async () => {
      mockDb.workspace.findUnique.mockResolvedValue(null);

      const result = await getWorkspaceById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("createWorkspace", () => {
    it("creates workspace with valid data and calls revalidatePath", async () => {
      const mockWorkspace = { id: "ws1", name: "New Workspace", description: null };
      mockDb.workspace.create.mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({ name: "New Workspace" });

      expect(result).toEqual(mockWorkspace);
      expect(mockDb.workspace.create).toHaveBeenCalledOnce();
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("throws Zod validation error when name is empty", async () => {
      await expect(createWorkspace({ name: "" })).rejects.toThrow();
      expect(mockDb.workspace.create).not.toHaveBeenCalled();
    });

    it("creates workspace with description", async () => {
      const mockWorkspace = { id: "ws1", name: "Workspace", description: "A description" };
      mockDb.workspace.create.mockResolvedValue(mockWorkspace);

      await createWorkspace({ name: "Workspace", description: "A description" });

      const callArgs = mockDb.workspace.create.mock.calls[0][0];
      expect(callArgs.data.description).toBe("A description");
    });
  });

  describe("updateWorkspace", () => {
    it("updates workspace with partial data", async () => {
      const mockWorkspace = { id: "ws1", name: "Updated Name" };
      mockDb.workspace.update.mockResolvedValue(mockWorkspace);

      const result = await updateWorkspace("ws1", { name: "Updated Name" });

      expect(result).toEqual(mockWorkspace);
      expect(mockDb.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws1" },
        data: expect.objectContaining({ name: "Updated Name" }),
      });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });
  });

  describe("deleteWorkspace", () => {
    it("deletes workspace and calls revalidatePath", async () => {
      mockDb.workspace.count.mockResolvedValue(2);
      mockDb.workspace.delete.mockResolvedValue({ id: "ws1" });

      await deleteWorkspace("ws1");

      expect(mockDb.workspace.delete).toHaveBeenCalledWith({ where: { id: "ws1" } });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("throws when trying to delete the last workspace", async () => {
      mockDb.workspace.count.mockResolvedValue(1);

      await expect(deleteWorkspace("ws1")).rejects.toThrow("Cannot delete the last workspace");
      expect(mockDb.workspace.delete).not.toHaveBeenCalled();
    });
  });

  describe("createProject", () => {
    it("sets type to GIT when gitUrl is provided", async () => {
      const mockProject = { id: "p1", name: "Git Project", type: "GIT" };
      mockDb.project.create.mockResolvedValue(mockProject);

      await createProject({
        name: "Git Project",
        workspaceId: "ws1",
        gitUrl: "https://github.com/example/repo",
      });

      const callArgs = mockDb.project.create.mock.calls[0][0];
      expect(callArgs.data.type).toBe("GIT");
    });

    it("sets type to NORMAL when gitUrl is not provided", async () => {
      const mockProject = { id: "p1", name: "Normal Project", type: "NORMAL" };
      mockDb.project.create.mockResolvedValue(mockProject);

      await createProject({
        name: "Normal Project",
        workspaceId: "ws1",
      });

      const callArgs = mockDb.project.create.mock.calls[0][0];
      expect(callArgs.data.type).toBe("NORMAL");
    });

    it("calls revalidatePath after creating project", async () => {
      const mockProject = { id: "p1", name: "Project", type: "NORMAL" };
      mockDb.project.create.mockResolvedValue(mockProject);

      await createProject({ name: "Project", workspaceId: "ws1" });

      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });
  });

  describe("getWorkspacesWithRecentTasks", () => {
    it("returns workspace array with nested project tasks and execution sessions", async () => {
      const mockData = [
        {
          id: "ws1",
          name: "Workspace",
          projects: [
            {
              id: "p1",
              name: "Project",
              alias: null,
              tasks: [
                {
                  id: "t1",
                  title: "Task",
                  status: "IN_PROGRESS",
                  priority: "MEDIUM",
                  executions: [{ sessionId: "session123" }],
                },
              ],
              _count: { tasks: 1 },
            },
          ],
        },
      ];
      mockDb.workspace.findMany.mockResolvedValue(mockData);

      const result = await getWorkspacesWithRecentTasks();

      expect(result).toEqual(mockData);
      expect(mockDb.workspace.findMany).toHaveBeenCalledOnce();
      // Verify query structure includes tasks with executions
      const callArgs = mockDb.workspace.findMany.mock.calls[0][0];
      const projectsSelect = callArgs.select.projects.select;
      expect(projectsSelect.tasks).toBeDefined();
      expect(projectsSelect._count).toBeDefined();
    });
  });
});
