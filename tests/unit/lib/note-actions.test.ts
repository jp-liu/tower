// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mock next/cache before importing server actions
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Use real fts.ts — it operates against the same SQLite DB
import {
  createNote,
  updateNote,
  deleteNote,
  getNoteById,
  getProjectNotes,
} from "@/actions/note-actions";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;

beforeAll(async () => {
  await testDb.$connect();

  // Ensure FTS5 table exists
  await testDb.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
    USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize='trigram case_sensitive 0'
    )
  `);

  // Create test workspace and project
  const workspace = await testDb.workspace.create({
    data: { name: "Note Actions Test Workspace" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Note Actions Test Project",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;
});

afterAll(async () => {
  // Delete all notes' FTS entries then clean up workspace (cascade)
  const notes = await testDb.projectNote.findMany({
    where: { projectId: testProjectId },
  });
  for (const n of notes) {
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", n.id);
  }
  await testDb.workspace.delete({ where: { id: testWorkspaceId } });
  await testDb.$disconnect();
});

describe("createNote", () => {
  it("creates a note with default category '备忘'", async () => {
    const note = await createNote({
      title: "Test Note Default Category",
      content: "Some content",
      projectId: testProjectId,
    });

    expect(note.id).toBeTruthy();
    expect(note.title).toBe("Test Note Default Category");
    expect(note.content).toBe("Some content");
    expect(note.category).toBe("备忘");
    expect(note.projectId).toBe(testProjectId);

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });

  it("creates a note with a custom category", async () => {
    const note = await createNote({
      title: "Account Note",
      content: "Login credentials",
      category: "账号",
      projectId: testProjectId,
    });

    expect(note.category).toBe("账号");

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });

  it("syncs note to FTS after creation", async () => {
    const note = await createNote({
      title: "FTS Sync Test Note",
      content: "Should appear in FTS",
      projectId: testProjectId,
    });

    const rows = await testDb.$queryRawUnsafe<{ note_id: string }[]>(
      "SELECT note_id FROM notes_fts WHERE note_id = ?",
      note.id
    );
    expect(rows.length).toBe(1);

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });

  it("throws ZodError for empty title", async () => {
    await expect(
      createNote({
        title: "",
        content: "Some content",
        projectId: testProjectId,
      })
    ).rejects.toThrow();
  });

  it("throws ZodError for missing projectId", async () => {
    await expect(
      createNote({
        title: "Valid Title",
        content: "Some content",
        projectId: "",
      })
    ).rejects.toThrow();
  });
});

describe("updateNote", () => {
  it("updates the title and content of a note", async () => {
    const note = await createNote({
      title: "Original Title",
      content: "Original content",
      projectId: testProjectId,
    });

    const updated = await updateNote(note.id, {
      title: "Updated Title",
      content: "Updated content",
    });

    expect(updated.title).toBe("Updated Title");
    expect(updated.content).toBe("Updated content");
    expect(updated.id).toBe(note.id);

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });

  it("re-syncs FTS after update", async () => {
    const note = await createNote({
      title: "Before Update",
      content: "Old content",
      projectId: testProjectId,
    });

    await updateNote(note.id, { title: "After Update", content: "New content" });

    const rows = await testDb.$queryRawUnsafe<{ title: string }[]>(
      "SELECT title FROM notes_fts WHERE note_id = ?",
      note.id
    );
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("After Update");

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });

  it("throws ZodError for title that is empty string", async () => {
    const note = await createNote({
      title: "Valid Note",
      content: "Valid content",
      projectId: testProjectId,
    });

    await expect(updateNote(note.id, { title: "" })).rejects.toThrow();

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });
});

describe("deleteNote", () => {
  it("deletes the note and removes from FTS", async () => {
    const note = await createNote({
      title: "To Delete",
      content: "Delete me",
      projectId: testProjectId,
    });

    await deleteNote(note.id);

    const found = await testDb.projectNote.findUnique({ where: { id: note.id } });
    expect(found).toBeNull();

    const ftsRows = await testDb.$queryRawUnsafe<{ note_id: string }[]>(
      "SELECT note_id FROM notes_fts WHERE note_id = ?",
      note.id
    );
    expect(ftsRows.length).toBe(0);
  });
});

describe("getNoteById", () => {
  it("returns the note when found", async () => {
    const note = await createNote({
      title: "Get By ID",
      content: "Found it",
      projectId: testProjectId,
    });

    const found = await getNoteById(note.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(note.id);

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
    await testDb.projectNote.delete({ where: { id: note.id } });
  });

  it("returns null for a non-existent note", async () => {
    const found = await getNoteById("nonexistent-id-12345");
    expect(found).toBeNull();
  });
});

describe("getProjectNotes", () => {
  it("returns all notes for a project without category filter", async () => {
    const note1 = await createNote({
      title: "Note One",
      content: "Content 1",
      category: "账号",
      projectId: testProjectId,
    });
    const note2 = await createNote({
      title: "Note Two",
      content: "Content 2",
      category: "环境",
      projectId: testProjectId,
    });

    const notes = await getProjectNotes(testProjectId);
    const ids = notes.map((n) => n.id);
    expect(ids).toContain(note1.id);
    expect(ids).toContain(note2.id);

    // Cleanup
    for (const n of [note1, note2]) {
      await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", n.id);
      await testDb.projectNote.delete({ where: { id: n.id } });
    }
  });

  it("filters notes by category when category option is provided", async () => {
    const accountNote = await createNote({
      title: "Account Note",
      content: "Account info",
      category: "账号",
      projectId: testProjectId,
    });
    const envNote = await createNote({
      title: "Env Note",
      content: "Env config",
      category: "环境",
      projectId: testProjectId,
    });

    const accountNotes = await getProjectNotes(testProjectId, { category: "账号" });
    const ids = accountNotes.map((n) => n.id);
    expect(ids).toContain(accountNote.id);
    expect(ids).not.toContain(envNote.id);

    // Cleanup
    for (const n of [accountNote, envNote]) {
      await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", n.id);
      await testDb.projectNote.delete({ where: { id: n.id } });
    }
  });
});
