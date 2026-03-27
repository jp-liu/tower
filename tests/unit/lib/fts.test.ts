// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { searchNotes, syncNoteToFts, deleteNoteFromFts } from "@/lib/fts";

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
    data: { name: "FTS Test Workspace" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "FTS Test Project",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;
});

afterAll(async () => {
  // Clean up test workspace (cascades to projects and notes)
  await testDb.workspace.delete({ where: { id: testWorkspaceId } });
  await testDb.$disconnect();
});

afterEach(async () => {
  // Remove all notes for this project and clean FTS
  const notes = await testDb.projectNote.findMany({
    where: { projectId: testProjectId },
  });
  for (const note of notes) {
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
  }
  await testDb.projectNote.deleteMany({ where: { projectId: testProjectId } });
});

describe("searchNotes", () => {
  it("returns empty array for empty query", async () => {
    const results = await searchNotes(testDb, testProjectId, "");
    expect(results).toEqual([]);
  });

  it("returns empty array for whitespace-only query", async () => {
    const results = await searchNotes(testDb, testProjectId, "   ");
    expect(results).toEqual([]);
  });

  it("uses LIKE fallback for 2-char query and finds matching note", async () => {
    // Create a note and sync it to FTS
    const note = await testDb.projectNote.create({
      data: {
        title: "AB Test Note",
        content: "Some content here",
        projectId: testProjectId,
      },
    });

    // 2-char query: should use LIKE fallback (not FTS5 which needs 3+ chars)
    const results = await searchNotes(testDb, testProjectId, "AB");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].note_id).toBe(note.id);
    expect(results[0].title).toBe("AB Test Note");
  });

  it("uses FTS5 MATCH for 3+ char query", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "API Configuration",
        content: "This note covers API setup",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await searchNotes(testDb, testProjectId, "API");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].note_id).toBe(note.id);
  });

  it("FTS5 search returns Chinese characters (3+ chars)", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "账号配置",
        content: "这是账号相关的配置信息",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    // Chinese "账号配" is 3 chars
    const results = await searchNotes(testDb, testProjectId, "账号配");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].note_id).toBe(note.id);
  });

  it("does not return notes from other projects", async () => {
    // Create another project
    const otherProject = await testDb.project.create({
      data: { name: "Other Project", workspaceId: testWorkspaceId },
    });

    const otherNote = await testDb.projectNote.create({
      data: {
        title: "Other Project Note",
        content: "secret content",
        projectId: otherProject.id,
      },
    });
    await syncNoteToFts(testDb, { id: otherNote.id, title: otherNote.title, content: otherNote.content });

    const results = await searchNotes(testDb, testProjectId, "secret");

    // Should not find the other project's note
    const found = results.find((r) => r.note_id === otherNote.id);
    expect(found).toBeUndefined();

    // Cleanup
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", otherNote.id);
    await testDb.project.delete({ where: { id: otherProject.id } });
  });
});

describe("syncNoteToFts", () => {
  it("inserts a row into notes_fts", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "Sync Test",
        content: "content for sync test",
        projectId: testProjectId,
      },
    });

    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const rows = await testDb.$queryRawUnsafe<{ note_id: string }[]>(
      "SELECT note_id FROM notes_fts WHERE note_id = ?",
      note.id
    );
    expect(rows.length).toBe(1);
    expect(rows[0].note_id).toBe(note.id);
  });

  it("replaces existing FTS row on re-sync (delete+insert)", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "Original Title",
        content: "Original content",
        projectId: testProjectId,
      },
    });

    // Sync once
    await syncNoteToFts(testDb, { id: note.id, title: "Original Title", content: "Original content" });
    // Sync again with updated data — should not duplicate
    await syncNoteToFts(testDb, { id: note.id, title: "Updated Title", content: "Updated content" });

    const rows = await testDb.$queryRawUnsafe<{ note_id: string; title: string }[]>(
      "SELECT note_id, title FROM notes_fts WHERE note_id = ?",
      note.id
    );
    // Should have exactly 1 row with updated title
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Updated Title");
  });
});

describe("deleteNoteFromFts", () => {
  it("removes the note from notes_fts", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "To Delete",
        content: "delete me",
        projectId: testProjectId,
      },
    });

    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });
    await deleteNoteFromFts(testDb, note.id);

    const rows = await testDb.$queryRawUnsafe<{ note_id: string }[]>(
      "SELECT note_id FROM notes_fts WHERE note_id = ?",
      note.id
    );
    expect(rows.length).toBe(0);
  });

  it("does not throw when deleting a non-existent note from FTS", async () => {
    await expect(deleteNoteFromFts(testDb, "nonexistent-id")).resolves.not.toThrow();
  });
});
