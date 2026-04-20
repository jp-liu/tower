import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("../../db", () => ({
  db: {
    label: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    taskLabel: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { db } from "../../db";
import { labelTools } from "../label-tools";

const mockDb = db as {
  label: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  taskLabel: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("label-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list_labels", () => {
    it("calls db.label.findMany with OR condition for builtin and workspace-specific labels", async () => {
      const mockLabels = [
        { id: "l1", name: "Bug", color: "#ff0000", isBuiltin: true },
        { id: "l2", name: "Custom", color: "#00ff00", isBuiltin: false, workspaceId: "ws1" },
      ];
      mockDb.label.findMany.mockResolvedValue(mockLabels);

      const result = await labelTools.list_labels.handler({ workspaceId: "ws1" });

      expect(mockDb.label.findMany).toHaveBeenCalledOnce();
      const callArgs = mockDb.label.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toEqual(
        expect.arrayContaining([{ isBuiltin: true }, { workspaceId: "ws1" }])
      );
      expect(result).toEqual(mockLabels);
    });
  });

  describe("create_label", () => {
    it("calls db.label.create with name, color, and workspaceId", async () => {
      const mockLabel = { id: "l1", name: "Feature", color: "#0000ff", workspaceId: "ws1" };
      mockDb.label.create.mockResolvedValue(mockLabel);

      const result = await labelTools.create_label.handler({
        workspaceId: "ws1",
        name: "Feature",
        color: "#0000ff",
      });

      expect(mockDb.label.create).toHaveBeenCalledWith({
        data: { name: "Feature", color: "#0000ff", workspaceId: "ws1" },
      });
      expect(result).toEqual(mockLabel);
    });
  });

  describe("delete_label", () => {
    it("calls db.label.delete and returns { deleted: true }", async () => {
      mockDb.label.delete.mockResolvedValue({ id: "l1" });

      const result = await labelTools.delete_label.handler({ labelId: "l1" });

      expect(mockDb.label.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
      expect(result).toEqual({ deleted: true });
    });
  });

  describe("set_task_labels", () => {
    it("calls tx.taskLabel.deleteMany then tx.taskLabel.createMany in transaction for non-empty labelIds", async () => {
      const mockTx = {
        taskLabel: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      };
      mockDb.$transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)
      );

      const result = await labelTools.set_task_labels.handler({
        taskId: "task1",
        labelIds: ["l1", "l2"],
      });

      expect(mockTx.taskLabel.deleteMany).toHaveBeenCalledWith({
        where: { taskId: "task1" },
      });
      expect(mockTx.taskLabel.createMany).toHaveBeenCalledWith({
        data: [
          { taskId: "task1", labelId: "l1" },
          { taskId: "task1", labelId: "l2" },
        ],
      });
      expect(result).toEqual({ taskId: "task1", labelIds: ["l1", "l2"] });
    });

    it("calls tx.taskLabel.deleteMany but NOT createMany for empty labelIds", async () => {
      const mockTx = {
        taskLabel: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      };
      mockDb.$transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)
      );

      const result = await labelTools.set_task_labels.handler({
        taskId: "task1",
        labelIds: [],
      });

      expect(mockTx.taskLabel.deleteMany).toHaveBeenCalledWith({
        where: { taskId: "task1" },
      });
      expect(mockTx.taskLabel.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ taskId: "task1", labelIds: [] });
    });
  });
});
