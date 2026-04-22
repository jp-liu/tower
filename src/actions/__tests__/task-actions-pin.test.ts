import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { db } from "@/lib/db";
import { toggleTaskPinned } from "@/actions/task-actions";

const mockDb = db as unknown as {
  task: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toggleTaskPinned", () => {
  const validCuid = "cm1234567890abcdefghij";

  it("throws on invalid taskId (not CUID)", async () => {
    await expect(toggleTaskPinned("not-valid")).rejects.toThrow();
    expect(mockDb.task.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("throws on empty string", async () => {
    await expect(toggleTaskPinned("")).rejects.toThrow();
  });

  it("throws on SQL injection attempt", async () => {
    await expect(toggleTaskPinned("'; DROP TABLE task; --")).rejects.toThrow();
    expect(mockDb.task.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("toggles pinned false → true", async () => {
    mockDb.task.findUniqueOrThrow.mockResolvedValue({ pinned: false });
    mockDb.task.update.mockResolvedValue({ id: validCuid, pinned: true });

    const result = await toggleTaskPinned(validCuid);

    expect(mockDb.task.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: validCuid },
      select: { pinned: true },
    });
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: validCuid },
      data: { pinned: true },
    });
    expect(result.pinned).toBe(true);
  });

  it("toggles pinned true → false", async () => {
    mockDb.task.findUniqueOrThrow.mockResolvedValue({ pinned: true });
    mockDb.task.update.mockResolvedValue({ id: validCuid, pinned: false });

    const result = await toggleTaskPinned(validCuid);

    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: validCuid },
      data: { pinned: false },
    });
    expect(result.pinned).toBe(false);
  });

  it("throws when task not found", async () => {
    mockDb.task.findUniqueOrThrow.mockRejectedValue(new Error("Record not found"));

    await expect(toggleTaskPinned(validCuid)).rejects.toThrow("Record not found");
  });
});
