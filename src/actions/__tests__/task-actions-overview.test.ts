import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { getTaskOverview } from "@/actions/task-actions";

const mockDb = db as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTaskOverview", () => {
  it("returns null for invalid CUID", async () => {
    const result = await getTaskOverview("not-a-cuid");
    expect(result).toBeNull();
    expect(mockDb.task.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for empty string", async () => {
    const result = await getTaskOverview("");
    expect(result).toBeNull();
  });

  it("returns null for SQL injection attempt", async () => {
    const result = await getTaskOverview("'; DROP TABLE task; --");
    expect(result).toBeNull();
    expect(mockDb.task.findUnique).not.toHaveBeenCalled();
  });

  it("queries DB for valid CUID", async () => {
    mockDb.task.findUnique.mockResolvedValue({
      id: "cm1234567890abcdefghij",
      title: "Test Task",
    });

    const result = await getTaskOverview("cm1234567890abcdefghij");
    expect(mockDb.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cm1234567890abcdefghij" },
      })
    );
    expect(result).toBeTruthy();
  });

  it("returns null when task not found", async () => {
    mockDb.task.findUnique.mockResolvedValue(null);
    const result = await getTaskOverview("cm1234567890abcdefghij");
    expect(result).toBeNull();
  });
});
