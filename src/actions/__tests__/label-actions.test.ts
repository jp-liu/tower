import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("@/lib/db", () => ({
  db: {
    label: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
  updateLabel,
  deleteLabel,
  setTaskLabels,
  getTaskLabels,
} from "@/actions/label-actions";

const mockDb = db as unknown as {
  label: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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
    it("queries with OR including system-level and workspace-specific labels", async () => {
      const mockLabels = [
        { id: "l1", name: "Bug", color: "#ff0000", isBuiltin: false, workspaceId: null },
        { id: "l2", name: "Custom", color: "#00ff00", isBuiltin: false, workspaceId: "ws1" },
      ];
      mockDb.label.findMany.mockResolvedValue(mockLabels);

      const result = await getLabelsForWorkspace("ws1");

      expect(result).toEqual(mockLabels);
      const callArgs = mockDb.label.findMany.mock.calls[0][0];
      // System-level visibility keys off `workspaceId: null`, NOT `isBuiltin` —
      // that flag only protects a label from edits/deletion.
      expect(callArgs.where.OR).toEqual(
        expect.arrayContaining([
          { workspaceId: null },
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
    it("deletes workspace label and calls revalidatePath", async () => {
      const mockLabel = { id: "l1", name: "Custom", isBuiltin: false, workspaceId: "ws1" };
      mockDb.label.findUnique.mockResolvedValue(mockLabel);
      mockDb.label.delete.mockResolvedValue(mockLabel);

      await deleteLabel("l1");

      expect(mockDb.label.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    // Only Tower is protected: a system-level label (workspaceId null) is an
    // ordinary starter label the user may throw away.
    it("deletes a system-level label that is not Tower's marker", async () => {
      const mockLabel = { id: "l1", name: "prd", isBuiltin: false, workspaceId: null };
      mockDb.label.findUnique.mockResolvedValue(mockLabel);
      mockDb.label.delete.mockResolvedValue(mockLabel);

      await deleteLabel("l1");

      expect(mockDb.label.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
    });

    it("throws 'Cannot delete the Tower label' for the builtin marker", async () => {
      const mockLabel = { id: "l1", name: "Tower", isBuiltin: true, workspaceId: null };
      mockDb.label.findUnique.mockResolvedValue(mockLabel);

      await expect(deleteLabel("l1")).rejects.toThrow("Cannot delete the Tower label");
      expect(mockDb.label.delete).not.toHaveBeenCalled();
    });

    it("throws 'Label not found' when label does not exist", async () => {
      mockDb.label.findUnique.mockResolvedValue(null);

      await expect(deleteLabel("nonexistent")).rejects.toThrow("Label not found");
      expect(mockDb.label.delete).not.toHaveBeenCalled();
    });
  });

  describe("updateLabel", () => {
    it("renames a workspace label", async () => {
      mockDb.label.findUnique.mockResolvedValue({ id: "l1", isBuiltin: false, workspaceId: "ws1" });
      mockDb.label.update.mockResolvedValue({ id: "l1", name: "Hotfix" });

      await updateLabel("l1", { name: "  Hotfix  " });

      expect(mockDb.label.update).toHaveBeenCalledWith({
        where: { id: "l1" },
        data: { name: "Hotfix" },
      });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("renames a system-level label — only Tower's marker is protected", async () => {
      mockDb.label.findUnique.mockResolvedValue({ id: "l1", name: "prd", isBuiltin: false, workspaceId: null });
      mockDb.label.update.mockResolvedValue({ id: "l1", name: "需求" });

      await updateLabel("l1", { name: "需求" });

      expect(mockDb.label.update).toHaveBeenCalledWith({
        where: { id: "l1" },
        data: { name: "需求" },
      });
    });

    it("refuses to touch the Tower label", async () => {
      mockDb.label.findUnique.mockResolvedValue({ id: "l1", name: "Tower", isBuiltin: true, workspaceId: null });

      await expect(updateLabel("l1", { name: "Something" })).rejects.toThrow(
        "Cannot edit the Tower label"
      );
      expect(mockDb.label.update).not.toHaveBeenCalled();
    });

    it("lets a system-level label set its branch prefix", async () => {
      mockDb.label.findUnique.mockResolvedValue({ id: "l1", name: "prd", isBuiltin: false, workspaceId: null });
      mockDb.label.update.mockResolvedValue({ id: "l1", branchPrefix: "feature" });

      await updateLabel("l1", { branchPrefix: "feature" });

      expect(mockDb.label.update).toHaveBeenCalledWith({
        where: { id: "l1" },
        data: { branchPrefix: "feature" },
      });
    });

    it("clears the branch prefix when given an empty string", async () => {
      mockDb.label.findUnique.mockResolvedValue({ id: "l1", isBuiltin: false, workspaceId: "ws1" });
      mockDb.label.update.mockResolvedValue({ id: "l1", branchPrefix: null });

      await updateLabel("l1", { branchPrefix: "  " });

      expect(mockDb.label.update).toHaveBeenCalledWith({
        where: { id: "l1" },
        data: { branchPrefix: null },
      });
    });

    it("rejects an invalid branch prefix before touching the db", async () => {
      await expect(updateLabel("l1", { branchPrefix: "../evil" })).rejects.toThrow();
      expect(mockDb.label.update).not.toHaveBeenCalled();
    });

    it("rejects an empty name", async () => {
      await expect(updateLabel("l1", { name: "   " })).rejects.toThrow();
      expect(mockDb.label.update).not.toHaveBeenCalled();
    });

    it("throws 'Label not found' when label does not exist", async () => {
      mockDb.label.findUnique.mockResolvedValue(null);

      await expect(updateLabel("nonexistent", { name: "X" })).rejects.toThrow("Label not found");
      expect(mockDb.label.update).not.toHaveBeenCalled();
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
