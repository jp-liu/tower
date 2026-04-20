import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("@/lib/db", () => ({
  db: {
    label: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    taskLabel: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  getLabelsForWorkspace,
  createLabel,
  deleteLabel,
  setTaskLabels,
  getTaskLabels,
} from "@/actions/label-actions";

const mockDb = db as {
  label: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  taskLabel: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("label-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getLabelsForWorkspace", () => {
    it("queries with OR including builtin and workspace-specific labels", async () => {
      const mockLabels = [
        { id: "l1", name: "Bug", color: "#ff0000", isBuiltin: true },
        { id: "l2", name: "Custom", color: "#00ff00", isBuiltin: false, workspaceId: "ws1" },
      ];
      mockDb.label.findMany.mockResolvedValue(mockLabels);

      const result = await getLabelsForWorkspace("ws1");

      expect(result).toEqual(mockLabels);
      const callArgs = mockDb.label.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toEqual(
        expect.arrayContaining([
          { isBuiltin: true },
          { workspaceId: "ws1" },
        ])
      );
    });
  });

  describe("createLabel", () => {
    it("creates label with valid data and calls revalidatePath", async () => {
      const mockLabel = { id: "l1", name: "Feature", color: "#0000ff", workspaceId: "ws1" };
      mockDb.label.create.mockResolvedValue(mockLabel);

      const result = await createLabel({ name: "Feature", color: "#0000ff", workspaceId: "ws1" });

      expect(result).toEqual(mockLabel);
      expect(mockDb.label.create).toHaveBeenCalledOnce();
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("throws Zod validation error for invalid hex color", async () => {
      await expect(
        createLabel({ name: "Label", color: "red", workspaceId: "ws1" })
      ).rejects.toThrow();
      expect(mockDb.label.create).not.toHaveBeenCalled();
    });

    it("throws Zod validation error for empty name", async () => {
      await expect(
        createLabel({ name: "", color: "#ffffff", workspaceId: "ws1" })
      ).rejects.toThrow();
      expect(mockDb.label.create).not.toHaveBeenCalled();
    });
  });

  describe("deleteLabel", () => {
    it("deletes non-builtin label and calls revalidatePath", async () => {
      const mockLabel = { id: "l1", name: "Custom", isBuiltin: false };
      mockDb.label.findUnique.mockResolvedValue(mockLabel);
      mockDb.label.delete.mockResolvedValue(mockLabel);

      await deleteLabel("l1");

      expect(mockDb.label.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("throws 'Cannot delete builtin labels' when label is builtin", async () => {
      const mockLabel = { id: "l1", name: "Bug", isBuiltin: true };
      mockDb.label.findUnique.mockResolvedValue(mockLabel);

      await expect(deleteLabel("l1")).rejects.toThrow("Cannot delete builtin labels");
      expect(mockDb.label.delete).not.toHaveBeenCalled();
    });

    it("throws 'Label not found' when label does not exist", async () => {
      mockDb.label.findUnique.mockResolvedValue(null);

      await expect(deleteLabel("nonexistent")).rejects.toThrow("Label not found");
      expect(mockDb.label.delete).not.toHaveBeenCalled();
    });
  });

  describe("setTaskLabels", () => {
    it("calls deleteMany then createMany in transaction for non-empty label array", async () => {
      const mockTx = {
        taskLabel: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      };
      mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx));

      await setTaskLabels("task1", ["l1", "l2"]);

      expect(mockTx.taskLabel.deleteMany).toHaveBeenCalledWith({ where: { taskId: "task1" } });
      expect(mockTx.taskLabel.createMany).toHaveBeenCalledWith({
        data: [
          { taskId: "task1", labelId: "l1" },
          { taskId: "task1", labelId: "l2" },
        ],
      });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("calls deleteMany but NOT createMany when labelIds is empty array", async () => {
      const mockTx = {
        taskLabel: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      };
      mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx));

      await setTaskLabels("task1", []);

      expect(mockTx.taskLabel.deleteMany).toHaveBeenCalledWith({ where: { taskId: "task1" } });
      expect(mockTx.taskLabel.createMany).not.toHaveBeenCalled();
    });
  });

  describe("getTaskLabels", () => {
    it("maps taskLabel results to label objects", async () => {
      const mockTaskLabels = [
        { taskId: "t1", labelId: "l1", label: { id: "l1", name: "Bug", color: "#ff0000", isBuiltin: true } },
        { taskId: "t1", labelId: "l2", label: { id: "l2", name: "Custom", color: "#00ff00", isBuiltin: false } },
      ];
      mockDb.taskLabel.findMany.mockResolvedValue(mockTaskLabels);

      const result = await getTaskLabels("t1");

      expect(result).toEqual([
        { id: "l1", name: "Bug", color: "#ff0000", isBuiltin: true },
        { id: "l2", name: "Custom", color: "#00ff00", isBuiltin: false },
      ]);
      expect(mockDb.taskLabel.findMany).toHaveBeenCalledWith({
        where: { taskId: "t1" },
        include: { label: true },
      });
    });
  });
});
