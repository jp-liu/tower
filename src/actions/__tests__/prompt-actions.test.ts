import { describe, it, expect, vi, beforeEach } from "vitest";

// mockTx must be defined before vi.mock (hoisted)
const mockTx = {
  agentPrompt: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    agentPrompt: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  getPrompts,
  getPromptById,
  createPrompt,
  updatePrompt,
  deletePrompt,
  setDefaultPrompt,
} from "@/actions/prompt-actions";

const mockDb = db as {
  agentPrompt: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.agentPrompt.updateMany.mockResolvedValue({ count: 1 });
  mockTx.agentPrompt.update.mockResolvedValue({ id: "p1", isDefault: true });
});

describe("getPrompts", () => {
  it("with workspaceId: includes OR clause for workspace-specific and global (null) prompts", async () => {
    mockDb.agentPrompt.findMany.mockResolvedValue([]);
    await getPrompts("ws1");
    expect(mockDb.agentPrompt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ workspaceId: "ws1" }, { workspaceId: null }] },
      })
    );
  });

  it("without workspaceId: uses empty where clause (returns all)", async () => {
    mockDb.agentPrompt.findMany.mockResolvedValue([]);
    await getPrompts();
    expect(mockDb.agentPrompt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

describe("getPromptById", () => {
  it("calls findUnique with correct id", async () => {
    const prompt = { id: "p1", name: "Test" };
    mockDb.agentPrompt.findUnique.mockResolvedValue(prompt);
    const result = await getPromptById("p1");
    expect(mockDb.agentPrompt.findUnique).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(result).toEqual(prompt);
  });
});

describe("createPrompt", () => {
  it("calls create with data and revalidates paths", async () => {
    const data = { name: "My Prompt", content: "Hello", description: "desc" };
    const created = { id: "p1", ...data };
    mockDb.agentPrompt.create.mockResolvedValue(created);

    const result = await createPrompt(data);

    expect(mockDb.agentPrompt.create).toHaveBeenCalledWith({ data });
    expect(result).toEqual(created);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("throws when content exceeds 100000 characters", async () => {
    const longContent = "x".repeat(100_001);
    await expect(
      createPrompt({ name: "Big", content: longContent })
    ).rejects.toThrow(/maximum length of 100000/);
    expect(mockDb.agentPrompt.create).not.toHaveBeenCalled();
  });

  it("accepts content at exactly 100000 characters", async () => {
    const maxContent = "x".repeat(100_000);
    mockDb.agentPrompt.create.mockResolvedValue({ id: "p1", name: "ok", content: maxContent });
    await expect(createPrompt({ name: "ok", content: maxContent })).resolves.not.toThrow();
  });
});

describe("updatePrompt", () => {
  it("calls update with id and data, revalidates paths", async () => {
    const updated = { id: "p1", name: "New Name" };
    mockDb.agentPrompt.update.mockResolvedValue(updated);

    const result = await updatePrompt("p1", { name: "New Name" });

    expect(mockDb.agentPrompt.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { name: "New Name" },
    });
    expect(result).toEqual(updated);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("throws when content exceeds 100000 characters", async () => {
    const longContent = "x".repeat(100_001);
    await expect(
      updatePrompt("p1", { content: longContent })
    ).rejects.toThrow(/maximum length of 100000/);
    expect(mockDb.agentPrompt.update).not.toHaveBeenCalled();
  });

  it("skips content length check when content is not provided", async () => {
    mockDb.agentPrompt.update.mockResolvedValue({ id: "p1", name: "updated" });
    await expect(updatePrompt("p1", { name: "updated" })).resolves.not.toThrow();
  });
});

describe("deletePrompt", () => {
  it("calls delete with correct id and revalidates paths", async () => {
    mockDb.agentPrompt.delete.mockResolvedValue({ id: "p1" });

    await deletePrompt("p1");

    expect(mockDb.agentPrompt.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });
});

describe("setDefaultPrompt", () => {
  it("unsets previous defaults FIRST via updateMany, then sets new default via update", async () => {
    const callOrder: string[] = [];
    mockTx.agentPrompt.updateMany.mockImplementation(async () => {
      callOrder.push("updateMany");
      return { count: 1 };
    });
    mockTx.agentPrompt.update.mockImplementation(async () => {
      callOrder.push("update");
      return { id: "p1", isDefault: true };
    });

    await setDefaultPrompt("p1");

    expect(callOrder).toEqual(["updateMany", "update"]);
    expect(mockTx.agentPrompt.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    expect(mockTx.agentPrompt.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { isDefault: true },
    });
  });

  it("with workspaceId: updateMany where clause includes workspaceId filter (scoped unset)", async () => {
    await setDefaultPrompt("p1", "ws1");

    expect(mockTx.agentPrompt.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws1", isDefault: true },
      data: { isDefault: false },
    });
  });

  it("without workspaceId: updateMany where clause only filters by isDefault (global unset)", async () => {
    await setDefaultPrompt("p1");

    expect(mockTx.agentPrompt.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  });

  it("revalidates paths after transaction", async () => {
    await setDefaultPrompt("p1");

    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("runs both updateMany and update inside a $transaction", async () => {
    await setDefaultPrompt("p1");
    expect(mockDb.$transaction).toHaveBeenCalledOnce();
  });
});
