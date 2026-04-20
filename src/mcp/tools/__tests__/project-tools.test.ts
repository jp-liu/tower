// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db BEFORE imports
vi.mock("../../db", () => ({
  db: {
    project: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { db } from "../../db";
import { projectTools } from "../project-tools";

const mockDb = db as {
  project: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

describe("project-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── list_projects ──────────────────────────────────────────────────────

  describe("list_projects", () => {
    it("returns projects with taskCount and repositoryCount derived from array lengths", async () => {
      const mockProjects = [
        {
          id: "proj1",
          name: "Project Alpha",
          workspaceId: "ws1",
          tasks: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
          repositories: [{ id: "r1" }],
          updatedAt: new Date("2026-04-20"),
        },
        {
          id: "proj2",
          name: "Project Beta",
          workspaceId: "ws1",
          tasks: [],
          repositories: [],
          updatedAt: new Date("2026-04-19"),
        },
      ];
      mockDb.project.findMany.mockResolvedValue(mockProjects);

      const result = await projectTools.list_projects.handler({ workspaceId: "ws1" });

      expect(mockDb.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws1" },
        })
      );
      expect(result).toHaveLength(2);
      // tasks and repositories arrays should not appear in output
      expect(result[0]).not.toHaveProperty("tasks");
      expect(result[0]).not.toHaveProperty("repositories");
      // counts derived from array lengths
      expect(result[0].taskCount).toBe(3);
      expect(result[0].repositoryCount).toBe(1);
      expect(result[1].taskCount).toBe(0);
      expect(result[1].repositoryCount).toBe(0);
    });
  });

  // ─── create_project ──────────────────────────────────────────────────────

  describe("create_project", () => {
    it("sets type to GIT when gitUrl is provided", async () => {
      const createdProject = {
        id: "proj1",
        name: "Git Project",
        type: "GIT",
        gitUrl: "https://github.com/org/repo",
        workspaceId: "ws1",
      };
      mockDb.project.create.mockResolvedValue(createdProject);

      const result = await projectTools.create_project.handler({
        workspaceId: "ws1",
        name: "Git Project",
        gitUrl: "https://github.com/org/repo",
      });

      expect(mockDb.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "GIT",
          gitUrl: "https://github.com/org/repo",
        }),
      });
      expect(result.type).toBe("GIT");
    });

    it("sets type to NORMAL when gitUrl is absent", async () => {
      const createdProject = {
        id: "proj2",
        name: "Normal Project",
        type: "NORMAL",
        workspaceId: "ws1",
      };
      mockDb.project.create.mockResolvedValue(createdProject);

      const result = await projectTools.create_project.handler({
        workspaceId: "ws1",
        name: "Normal Project",
      });

      expect(mockDb.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "NORMAL",
        }),
      });
      // Ensure type is NORMAL not GIT — caller cannot override this
      expect(result.type).toBe("NORMAL");
    });

    it("passes alias to db.project.create when provided", async () => {
      const createdProject = { id: "proj3", name: "Aliased Project", alias: "myproj", type: "NORMAL", workspaceId: "ws1" };
      mockDb.project.create.mockResolvedValue(createdProject);

      await projectTools.create_project.handler({
        workspaceId: "ws1",
        name: "Aliased Project",
        alias: "myproj",
      });

      expect(mockDb.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alias: "myproj",
          type: "NORMAL",
        }),
      });
    });
  });

  // ─── update_project ──────────────────────────────────────────────────────

  describe("update_project", () => {
    it("excludes projectId from update data and spreads remaining fields", async () => {
      const updatedProject = { id: "proj1", name: "New Name", localPath: "/new/path" };
      mockDb.project.update.mockResolvedValue(updatedProject);

      const result = await projectTools.update_project.handler({
        projectId: "proj1",
        name: "New Name",
        localPath: "/new/path",
      });

      expect(mockDb.project.update).toHaveBeenCalledWith({
        where: { id: "proj1" },
        data: { name: "New Name", localPath: "/new/path" },
      });
      // projectId must not appear in the data
      const updateCall = mockDb.project.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("projectId");
      expect(result).toEqual(updatedProject);
    });
  });

  // ─── delete_project ──────────────────────────────────────────────────────

  describe("delete_project", () => {
    it("deletes project and returns confirmation with projectId", async () => {
      mockDb.project.delete.mockResolvedValue({ id: "proj1" });

      const result = await projectTools.delete_project.handler({ projectId: "proj1" });

      expect(mockDb.project.delete).toHaveBeenCalledWith({ where: { id: "proj1" } });
      expect(result).toEqual({ deleted: true, projectId: "proj1" });
    });
  });
});
