import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("../../db", () => ({
  db: {
    workspace: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { db } from "../../db";
import { workspaceTools } from "../workspace-tools";

const mockDb = db as {
  workspace: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

describe("workspace-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list_workspaces", () => {
    it("calls db.workspace.findMany with projects include and returns projectCount", async () => {
      const mockWorkspaces = [
        {
          id: "ws1",
          name: "Workspace 1",
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          projects: [{ id: "p1" }, { id: "p2" }],
        },
        {
          id: "ws2",
          name: "Workspace 2",
          description: "desc",
          createdAt: new Date(),
          updatedAt: new Date(),
          projects: [],
        },
      ];
      mockDb.workspace.findMany.mockResolvedValue(mockWorkspaces);

      const result = await workspaceTools.list_workspaces.handler({});

      expect(mockDb.workspace.findMany).toHaveBeenCalledOnce();
      const callArgs = mockDb.workspace.findMany.mock.calls[0][0];
      expect(callArgs.include.projects).toBeDefined();
      expect(callArgs.orderBy).toEqual({ updatedAt: "desc" });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: "ws1", name: "Workspace 1", projectCount: 2 });
      expect(result[0]).not.toHaveProperty("projects");
      expect(result[1]).toMatchObject({ id: "ws2", name: "Workspace 2", projectCount: 0 });
    });
  });

  describe("create_workspace", () => {
    it("calls db.workspace.create with name and description", async () => {
      const mockWorkspace = { id: "ws1", name: "New WS", description: "My desc", createdAt: new Date(), updatedAt: new Date() };
      mockDb.workspace.create.mockResolvedValue(mockWorkspace);

      const result = await workspaceTools.create_workspace.handler({ name: "New WS", description: "My desc" });

      expect(mockDb.workspace.create).toHaveBeenCalledWith({
        data: { name: "New WS", description: "My desc" },
      });
      expect(result).toEqual(mockWorkspace);
    });

    it("calls db.workspace.create without description when not provided", async () => {
      const mockWorkspace = { id: "ws1", name: "No Desc", description: null, createdAt: new Date(), updatedAt: new Date() };
      mockDb.workspace.create.mockResolvedValue(mockWorkspace);

      await workspaceTools.create_workspace.handler({ name: "No Desc" });

      expect(mockDb.workspace.create).toHaveBeenCalledWith({
        data: { name: "No Desc", description: undefined },
      });
    });
  });

  describe("update_workspace", () => {
    it("calls db.workspace.update with correct where and data", async () => {
      const mockWorkspace = { id: "ws1", name: "Updated", description: "new desc", createdAt: new Date(), updatedAt: new Date() };
      mockDb.workspace.update.mockResolvedValue(mockWorkspace);

      const result = await workspaceTools.update_workspace.handler({
        workspaceId: "ws1",
        name: "Updated",
        description: "new desc",
      });

      expect(mockDb.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws1" },
        data: { name: "Updated", description: "new desc" },
      });
      expect(result).toEqual(mockWorkspace);
    });

    it("calls db.workspace.update with partial data (name only)", async () => {
      const mockWorkspace = { id: "ws1", name: "Renamed", description: null, createdAt: new Date(), updatedAt: new Date() };
      mockDb.workspace.update.mockResolvedValue(mockWorkspace);

      await workspaceTools.update_workspace.handler({ workspaceId: "ws1", name: "Renamed" });

      expect(mockDb.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws1" },
        data: { name: "Renamed", description: undefined },
      });
    });
  });

  describe("delete_workspace", () => {
    it("calls db.workspace.delete with workspaceId and returns deleted: true", async () => {
      mockDb.workspace.delete.mockResolvedValue({ id: "ws1" });

      const result = await workspaceTools.delete_workspace.handler({ workspaceId: "ws1" });

      expect(mockDb.workspace.delete).toHaveBeenCalledWith({ where: { id: "ws1" } });
      expect(result).toEqual({ deleted: true, workspaceId: "ws1" });
    });
  });
});
