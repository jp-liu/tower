import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before any imports
vi.mock("@/lib/db", () => ({
  db: {
    projectNote: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/fts", () => ({
  syncNoteToFts: vi.fn(),
  deleteNoteFromFts: vi.fn(),
}));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { syncNoteToFts, deleteNoteFromFts } from "@/lib/fts";
import {
  createNote,
  updateNote,
  deleteNote,
  getNoteById,
  getProjectNotes,
  getTaskNotes,
} from "@/actions/note-actions";

const mockDb = db as {
  projectNote: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

const mockSyncNoteToFts = syncNoteToFts as ReturnType<typeof vi.fn>;
const mockDeleteNoteFromFts = deleteNoteFromFts as ReturnType<typeof vi.fn>;

describe("note-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createNote", () => {
    it("creates note with correct data and calls syncNoteToFts after create", async () => {
      const mockNote = {
        id: "note1",
        title: "My Note",
        content: "Content",
        category: "备忘",
        projectId: "proj1",
        taskId: null,
      };
      mockDb.projectNote.create.mockResolvedValue(mockNote);
      mockSyncNoteToFts.mockResolvedValue(undefined);

      const result = await createNote({ title: "My Note", content: "Content", projectId: "proj1" });

      expect(result).toEqual(mockNote);
      expect(mockDb.projectNote.create).toHaveBeenCalledOnce();
      expect(mockSyncNoteToFts).toHaveBeenCalledWith(db, {
        id: mockNote.id,
        title: mockNote.title,
        content: mockNote.content,
      });
      expect(revalidatePath).toHaveBeenCalledWith("/workspace");
    });

    it("uses default category '备忘' when category not provided", async () => {
      const mockNote = { id: "note1", title: "Test", content: "", category: "备忘", projectId: "p1", taskId: null };
      mockDb.projectNote.create.mockResolvedValue(mockNote);
      mockSyncNoteToFts.mockResolvedValue(undefined);

      await createNote({ title: "Test", content: "", projectId: "p1" });

      const callArgs = mockDb.projectNote.create.mock.calls[0][0];
      expect(callArgs.data.category).toBe("备忘");
    });

    it("uses provided category when given", async () => {
      const mockNote = { id: "note1", title: "Test", content: "", category: "账号", projectId: "p1", taskId: null };
      mockDb.projectNote.create.mockResolvedValue(mockNote);
      mockSyncNoteToFts.mockResolvedValue(undefined);

      await createNote({ title: "Test", content: "", projectId: "p1", category: "账号" });

      const callArgs = mockDb.projectNote.create.mock.calls[0][0];
      expect(callArgs.data.category).toBe("账号");
    });

    it("throws Zod validation error when title is empty", async () => {
      await expect(
        createNote({ title: "", content: "Content", projectId: "p1" })
      ).rejects.toThrow();
      expect(mockDb.projectNote.create).not.toHaveBeenCalled();
    });

    it("throws Zod validation error when title exceeds 200 characters", async () => {
      const longTitle = "a".repeat(201);
      await expect(
        createNote({ title: longTitle, content: "Content", projectId: "p1" })
      ).rejects.toThrow();
      expect(mockDb.projectNote.create).not.toHaveBeenCalled();
    });

    it("calls syncNoteToFts with correct shape { id, title, content }", async () => {
      const mockNote = { id: "note-abc", title: "Note Title", content: "Note content", category: "备忘", projectId: "p1", taskId: null };
      mockDb.projectNote.create.mockResolvedValue(mockNote);
      mockSyncNoteToFts.mockResolvedValue(undefined);

      await createNote({ title: "Note Title", content: "Note content", projectId: "p1" });

      expect(mockSyncNoteToFts).toHaveBeenCalledWith(
        db,
        { id: "note-abc", title: "Note Title", content: "Note content" }
      );
    });
  });

  describe("updateNote", () => {
    it("updates note and calls syncNoteToFts with updated data", async () => {
      const mockNote = { id: "note1", title: "Updated Title", content: "Updated Content", category: "备忘", projectId: "p1", taskId: null };
      mockDb.projectNote.update.mockResolvedValue(mockNote);
      mockSyncNoteToFts.mockResolvedValue(undefined);

      const result = await updateNote("note1", { title: "Updated Title", content: "Updated Content" });

      expect(result).toEqual(mockNote);
      expect(mockDb.projectNote.update).toHaveBeenCalledWith({
        where: { id: "note1" },
        data: expect.objectContaining({ title: "Updated Title", content: "Updated Content" }),
      });
      expect(mockSyncNoteToFts).toHaveBeenCalledWith(db, {
        id: mockNote.id,
        title: mockNote.title,
        content: mockNote.content,
      });
      expect(revalidatePath).toHaveBeenCalledWith("/workspace");
    });
  });

  describe("deleteNote", () => {
    it("calls deleteNoteFromFts BEFORE db.projectNote.delete", async () => {
      const callOrder: string[] = [];
      mockDeleteNoteFromFts.mockImplementation(async () => { callOrder.push("deleteNoteFromFts"); });
      mockDb.projectNote.delete.mockImplementation(async () => { callOrder.push("db.delete"); });

      await deleteNote("note1");

      expect(callOrder).toEqual(["deleteNoteFromFts", "db.delete"]);
      expect(mockDeleteNoteFromFts).toHaveBeenCalledWith(db, "note1");
      expect(mockDb.projectNote.delete).toHaveBeenCalledWith({ where: { id: "note1" } });
    });

    it("calls revalidatePath after deletion", async () => {
      mockDeleteNoteFromFts.mockResolvedValue(undefined);
      mockDb.projectNote.delete.mockResolvedValue({});

      await deleteNote("note1");

      expect(revalidatePath).toHaveBeenCalledWith("/workspace");
    });
  });

  describe("getNoteById", () => {
    it("calls findUnique with correct id", async () => {
      const mockNote = { id: "note1", title: "Note", content: "", category: "备忘", projectId: "p1", taskId: null };
      mockDb.projectNote.findUnique.mockResolvedValue(mockNote);

      const result = await getNoteById("note1");

      expect(result).toEqual(mockNote);
      expect(mockDb.projectNote.findUnique).toHaveBeenCalledWith({ where: { id: "note1" } });
    });

    it("returns null when note not found", async () => {
      mockDb.projectNote.findUnique.mockResolvedValue(null);

      const result = await getNoteById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getProjectNotes", () => {
    it("queries with projectId filter and taskId: null", async () => {
      const mockNotes = [{ id: "n1", title: "Note 1", projectId: "p1", taskId: null }];
      mockDb.projectNote.findMany.mockResolvedValue(mockNotes);

      const result = await getProjectNotes("p1");

      expect(result).toEqual(mockNotes);
      const callArgs = mockDb.projectNote.findMany.mock.calls[0][0];
      expect(callArgs.where.projectId).toBe("p1");
      expect(callArgs.where.taskId).toBeNull();
    });

    it("includes category filter when category option is provided", async () => {
      mockDb.projectNote.findMany.mockResolvedValue([]);

      await getProjectNotes("p1", { category: "账号" });

      const callArgs = mockDb.projectNote.findMany.mock.calls[0][0];
      expect(callArgs.where.category).toBe("账号");
    });

    it("does NOT include category in where clause when category is not provided", async () => {
      mockDb.projectNote.findMany.mockResolvedValue([]);

      await getProjectNotes("p1");

      const callArgs = mockDb.projectNote.findMany.mock.calls[0][0];
      expect(callArgs.where.category).toBeUndefined();
    });
  });

  describe("getTaskNotes", () => {
    it("queries with taskId filter", async () => {
      const mockNotes = [{ id: "n1", title: "Task Note", projectId: "p1", taskId: "t1" }];
      mockDb.projectNote.findMany.mockResolvedValue(mockNotes);

      const result = await getTaskNotes("t1");

      expect(result).toEqual(mockNotes);
      const callArgs = mockDb.projectNote.findMany.mock.calls[0][0];
      expect(callArgs.where.taskId).toBe("t1");
    });
  });
});
