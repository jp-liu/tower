import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    versionType: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  getVersionTypes,
  createVersionType,
  updateVersionType,
  deleteVersionType,
} from "@/actions/version-type-actions";

const mockDb = db as unknown as {
  versionType: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => vi.clearAllMocks());

describe("getVersionTypes", () => {
  it("queries with where:{workspaceId}", async () => {
    mockDb.versionType.findMany.mockResolvedValue([]);
    await getVersionTypes("ws1");
    expect(mockDb.versionType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws1" } })
    );
  });

  it("returns the list of version types", async () => {
    const fakeTypes = [
      { id: "t1", name: "Feature", workspaceId: "ws1" },
      { id: "t2", name: "Bugfix", workspaceId: "ws1" },
    ];
    mockDb.versionType.findMany.mockResolvedValue(fakeTypes);
    const result = await getVersionTypes("ws1");
    expect(result).toBe(fakeTypes);
  });
});

describe("createVersionType", () => {
  it("creates with {name, workspaceId} and revalidates path", async () => {
    const fakeType = { id: "t1", name: "Feature", workspaceId: "ws1" };
    mockDb.versionType.create.mockResolvedValue(fakeType);

    const result = await createVersionType({ workspaceId: "ws1", name: "Feature" });

    expect(mockDb.versionType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Feature", workspaceId: "ws1" }),
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(result).toBe(fakeType);
  });

  it("throws on empty name (schema validation)", async () => {
    await expect(
      createVersionType({ workspaceId: "ws1", name: "" })
    ).rejects.toThrow();
    expect(mockDb.versionType.create).not.toHaveBeenCalled();
  });
});

describe("updateVersionType", () => {
  it("updates name by id and revalidates path", async () => {
    const fakeType = { id: "t1", name: "Bugfix", workspaceId: "ws1" };
    mockDb.versionType.update.mockResolvedValue(fakeType);

    const result = await updateVersionType("t1", { name: "Bugfix" });

    expect(mockDb.versionType.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({ name: "Bugfix" }),
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(result).toBe(fakeType);
  });

  it("throws user-friendly error on P2025 (not found)", async () => {
    mockDb.versionType.update.mockRejectedValue({ code: "P2025" });
    await expect(updateVersionType("missing", { name: "X" })).rejects.toThrow(
      "类型不存在"
    );
  });
});

describe("deleteVersionType", () => {
  it("deletes by id and revalidates path", async () => {
    mockDb.versionType.delete.mockResolvedValue({ id: "t1" });

    await deleteVersionType("t1");

    expect(mockDb.versionType.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
  });

  it("throws user-friendly error on P2025 (not found)", async () => {
    mockDb.versionType.delete.mockRejectedValue({ code: "P2025" });
    await expect(deleteVersionType("missing")).rejects.toThrow("类型不存在");
  });
});
