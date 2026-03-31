// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncNoteToFts } from "@/lib/fts";
import type { SearchCategory, SearchResult } from "@/lib/search";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;

let globalSearchFn: (query: string, category?: SearchCategory) => Promise<SearchResult[]>;

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
    data: { name: "Search Actions Test WS" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Search Actions Test Proj",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;

  // Dynamic import: search-actions.ts uses "use server" directive
  const mod = await import("@/actions/search-actions");
  globalSearchFn = mod.globalSearch;
});

afterAll(async () => {
  // Delete test workspace (cascade to projects and notes)
  await testDb.workspace.delete({ where: { id: testWorkspaceId } });
  await testDb.$disconnect();
});

afterEach(async () => {
  // Clean up notes + FTS entries
  const notes = await testDb.projectNote.findMany({
    where: { projectId: testProjectId },
  });
  for (const note of notes) {
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
  }
  await testDb.projectNote.deleteMany({ where: { projectId: testProjectId } });

  // Clean up assets
  await testDb.projectAsset.deleteMany({ where: { projectId: testProjectId } });

  // Clean up tasks
  await testDb.task.deleteMany({ where: { projectId: testProjectId } });
});

describe("globalSearch - note category", () => {
  it("returns empty array for empty query", async () => {
    const results = await globalSearchFn("", "note");
    expect(results).toEqual([]);
  });

  it("returns notes with matching title via FTS5", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "API Configuration Guide",
        content: "This note covers API setup details",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await globalSearchFn("API", "note");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
    expect(found?.type).toBe("note");
  });

  it("returns notes with matching content via FTS5", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "General Notes",
        content: "Contains important config settings",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await globalSearchFn("config", "note");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
  });

  it("uses LIKE fallback for short query (< 3 chars)", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "AB Test Note",
        content: "some content",
        projectId: testProjectId,
      },
    });
    // Note NOT synced to FTS — LIKE fallback queries the ProjectNote table directly

    const results = await globalSearchFn("ab", "note");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
  });

  it("does not throw on malformed FTS5 query (unmatched quote) — falls back to LIKE", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "unmatched quote test note",
        content: "this has unmatched content",
        projectId: testProjectId,
      },
    });
    // Note NOT synced to FTS — LIKE fallback should still find it

    // '"unmatched' has an unmatched double quote — would crash FTS5 MATCH
    await expect(globalSearchFn('"unmatched', "note")).resolves.not.toThrow();
    const results = await globalSearchFn('"unmatched', "note");
    // LIKE fallback should find the note with "unmatched" in title/content
    expect(Array.isArray(results)).toBe(true);
  });

  it("note search result has navigateTo matching /workspaces/{wsId}?projectId={pId}", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "Navigation Test Note",
        content: "navigation content",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await globalSearchFn("Navigation", "note");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found?.navigateTo).toMatch(
      new RegExp(`/workspaces/${testWorkspaceId}/notes\\?projectId=${testProjectId}`)
    );
  });
});

describe("globalSearch - note category - snippet", () => {
  it("note result has snippet with first 80 chars of content", async () => {
    const longContent = "A".repeat(120);
    const note = await testDb.projectNote.create({
      data: {
        title: "Snippet Test Note",
        content: longContent,
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await globalSearchFn("Snippet Test", "note");
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
    expect(found?.snippet).toBe("A".repeat(80));
  });

  it("note result with empty content has undefined snippet", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "Empty Content Snippet Note",
        content: "",
        projectId: testProjectId,
      },
    });
    // Sync to FTS so the note is found by title match
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });
    const results = await globalSearchFn("Empty Content Snippet", "note");
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
    expect(found?.snippet).toBeUndefined();
  });
});

describe("globalSearch - asset category - snippet", () => {
  it("asset result has snippet equal to description", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "snippet-test.pdf",
        path: "/data/assets/snippet-test.pdf",
        size: 4096,
        mimeType: "application/pdf",
        description: "This is a detailed description of the test PDF file",
        projectId: testProjectId,
      },
    });

    const results = await globalSearchFn("snippet-test", "asset");
    const found = results.find((r) => r.title === "snippet-test.pdf");
    expect(found).toBeDefined();
    expect(found?.snippet).toBe("This is a detailed description of the test PDF file");
  });

  it("asset result with empty description has undefined snippet", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "no-desc-asset.txt",
        path: "/data/assets/no-desc-asset.txt",
        size: 128,
        mimeType: "text/plain",
        description: "",
        projectId: testProjectId,
      },
    });

    const results = await globalSearchFn("no-desc-asset", "asset");
    const found = results.find((r) => r.title === "no-desc-asset.txt");
    expect(found).toBeDefined();
    expect(found?.snippet).toBeUndefined();
  });
});

describe("globalSearch - asset category", () => {
  it("returns assets with matching filename", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "readme.md",
        path: "/data/assets/readme.md",
        size: 1024,
        mimeType: "text/markdown",
        description: "project documentation",
        projectId: testProjectId,
      },
    });

    const results = await globalSearchFn("readme", "asset");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.title === "readme.md");
    expect(found).toBeDefined();
    expect(found?.type).toBe("asset");
  });

  it("returns assets with matching description", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "config.yaml",
        path: "/data/assets/config.yaml",
        size: 512,
        mimeType: "text/yaml",
        description: "deployment configuration file",
        projectId: testProjectId,
      },
    });

    const results = await globalSearchFn("deployment", "asset");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.title === "config.yaml");
    expect(found).toBeDefined();
  });

  it("asset search result has navigateTo matching /workspaces/{wsId}?projectId={pId}", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "nav-asset.png",
        path: "/data/assets/nav-asset.png",
        size: 2048,
        mimeType: "image/png",
        description: "navigation test asset",
        projectId: testProjectId,
      },
    });

    const results = await globalSearchFn("nav-asset", "asset");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.title === "nav-asset.png");
    expect(found?.navigateTo).toMatch(
      new RegExp(`/workspaces/${testWorkspaceId}/assets\\?projectId=${testProjectId}`)
    );
  });
});

describe("globalSearch - all category", () => {
  it("returns results from multiple types", async () => {
    // Create a task with "testall" in title
    await testDb.task.create({
      data: {
        title: "testall task item",
        projectId: testProjectId,
      },
    });

    // Create a note with "testall" in title and sync to FTS
    const note = await testDb.projectNote.create({
      data: {
        title: "testall note item",
        content: "testall content",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    // Create an asset with "testall" in filename
    await testDb.projectAsset.create({
      data: {
        filename: "testall-file.txt",
        path: "/data/assets/testall-file.txt",
        size: 256,
        mimeType: "text/plain",
        description: "",
        projectId: testProjectId,
      },
    });

    const results = await globalSearchFn("testall", "all");
    expect(results.length).toBeGreaterThan(0);

    // Should have results from multiple types
    const types = new Set(results.map((r) => r.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it("each result has type discriminant in valid set", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "multitype-search-note",
        content: "multitype content",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await globalSearchFn("multitype", "all");
    const validTypes = new Set(["task", "project", "repository", "note", "asset"]);
    for (const r of results) {
      expect(validTypes.has(r.type)).toBe(true);
    }
  });

  it("returns empty array when nothing matches (not an error)", async () => {
    const results = await globalSearchFn("xxx_no_match_zzz_12345", "all");
    expect(results).toEqual([]);
  });
});
