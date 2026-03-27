// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;

// Dynamically import handler after module exists
let manageNotesHandler: (args: Record<string, unknown>) => Promise<unknown>;

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
    data: { name: "Manage Notes MCP Test Workspace" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Manage Notes MCP Test Project",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;

  // Import handler
  const mod = await import("@/mcp/tools/note-asset-tools");
  manageNotesHandler = mod.noteAssetTools.manage_notes.handler;
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

describe("manage_notes action=create", () => {
  it("creates a note with default category 备忘", async () => {
    const result = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "My Test Note",
      content: "Some content",
    }) as { id: string; title: string; category: string; projectId: string };

    expect(result.title).toBe("My Test Note");
    expect(result.category).toBe("备忘");
    expect(result.projectId).toBe(testProjectId);
    expect(result.id).toBeDefined();
  });

  it("creates a note with custom category", async () => {
    const result = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Env Note",
      content: "env config",
      category: "环境",
    }) as { category: string };

    expect(result.category).toBe("环境");
  });

  it("syncs note to FTS after create (action=search finds it)", async () => {
    await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Searchable API Note",
      content: "This contains API config data",
    });

    const results = await manageNotesHandler({
      action: "search",
      projectId: testProjectId,
      query: "API",
    }) as Array<{ title: string }>;

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("Searchable API Note");
  });

  it("throws when projectId is missing", async () => {
    await expect(
      manageNotesHandler({ action: "create", title: "No Project" })
    ).rejects.toThrow("projectId and title required");
  });

  it("throws when title is missing", async () => {
    await expect(
      manageNotesHandler({ action: "create", projectId: testProjectId })
    ).rejects.toThrow("projectId and title required");
  });
});

describe("manage_notes action=update", () => {
  it("updates note title", async () => {
    const created = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Original Title",
      content: "original content",
    }) as { id: string };

    const updated = await manageNotesHandler({
      action: "update",
      noteId: created.id,
      title: "Updated Title",
    }) as { title: string };

    expect(updated.title).toBe("Updated Title");
  });

  it("syncs FTS after update", async () => {
    const created = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Before Update",
      content: "old content xyz",
    }) as { id: string };

    await manageNotesHandler({
      action: "update",
      noteId: created.id,
      title: "After Update",
      content: "new content foobar",
    });

    const results = await manageNotesHandler({
      action: "search",
      projectId: testProjectId,
      query: "foobar",
    }) as Array<{ note_id: string }>;

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].note_id).toBe(created.id);
  });
});

describe("manage_notes action=delete", () => {
  it("deletes the note", async () => {
    const created = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "To Delete",
      content: "delete me",
    }) as { id: string };

    const result = await manageNotesHandler({
      action: "delete",
      noteId: created.id,
    }) as { deleted: boolean; noteId: string };

    expect(result.deleted).toBe(true);
    expect(result.noteId).toBe(created.id);

    const found = await testDb.projectNote.findUnique({ where: { id: created.id } });
    expect(found).toBeNull();
  });

  it("removes FTS entry after delete", async () => {
    const created = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "FTS Delete Test Note",
      content: "unique-fts-delete-content",
    }) as { id: string };

    await manageNotesHandler({ action: "delete", noteId: created.id });

    const rows = await testDb.$queryRawUnsafe<{ note_id: string }[]>(
      "SELECT note_id FROM notes_fts WHERE note_id = ?",
      created.id
    );
    expect(rows.length).toBe(0);
  });

  it("throws when noteId is missing", async () => {
    await expect(
      manageNotesHandler({ action: "delete" })
    ).rejects.toThrow("noteId required");
  });
});

describe("manage_notes action=get", () => {
  it("returns a note by ID", async () => {
    const created = await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Get Me",
      content: "get content",
    }) as { id: string };

    const result = await manageNotesHandler({
      action: "get",
      noteId: created.id,
    }) as { id: string; title: string };

    expect(result.id).toBe(created.id);
    expect(result.title).toBe("Get Me");
  });
});

describe("manage_notes action=list", () => {
  it("returns all notes for a project ordered by updatedAt desc", async () => {
    await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Note A",
      content: "a",
    });
    await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Note B",
      content: "b",
    });

    const results = await manageNotesHandler({
      action: "list",
      projectId: testProjectId,
    }) as Array<{ title: string }>;

    expect(results.length).toBe(2);
    // Most recently created should be first
    expect(results[0].title).toBe("Note B");
  });

  it("filters by category when provided", async () => {
    await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Env Note",
      content: "env",
      category: "环境",
    });
    await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Normal Note",
      content: "normal",
    });

    const results = await manageNotesHandler({
      action: "list",
      projectId: testProjectId,
      category: "环境",
    }) as Array<{ title: string; category: string }>;

    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Env Note");
    expect(results[0].category).toBe("环境");
  });
});

describe("manage_notes action=search", () => {
  it("returns FTS results matching query", async () => {
    await manageNotesHandler({
      action: "create",
      projectId: testProjectId,
      title: "Database Schema",
      content: "Describes the database schema and tables",
    });

    const results = await manageNotesHandler({
      action: "search",
      projectId: testProjectId,
      query: "schema",
    }) as Array<{ title: string }>;

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("Database Schema");
  });
});
