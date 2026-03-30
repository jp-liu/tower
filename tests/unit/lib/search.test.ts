// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncNoteToFts } from "@/lib/fts";
import type { SearchConfig } from "@/lib/search";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;

const defaultConfig: SearchConfig = {
  resultLimit: 20,
  allModeCap: 5,
  snippetLength: 80,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let searchFn: (query: string, category: any, config: SearchConfig) => Promise<unknown[]>;

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
    data: { name: "Search Lib Test WS" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Search Lib Test Proj",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;

  // Dynamic import: framework-agnostic module
  const mod = await import("@/lib/search");
  searchFn = mod.search;
});

afterAll(async () => {
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

describe("search - empty query", () => {
  it("Test 1: returns empty array for empty query (task category)", async () => {
    const results = await searchFn("", "task", defaultConfig);
    expect(results).toEqual([]);
  });

  it("returns empty array for whitespace-only query", async () => {
    const results = await searchFn("   ", "task", defaultConfig);
    expect(results).toEqual([]);
  });
});

describe("search - task category", () => {
  it("Test 2: returns task results with correct shape (id, type, title, subtitle, navigateTo)", async () => {
    await testDb.task.create({
      data: {
        title: "srchlib-task-shape-test",
        projectId: testProjectId,
      },
    });

    const results = await searchFn("srchlib-task-shape-test", "task", defaultConfig) as Array<{
      id: string;
      type: string;
      title: string;
      subtitle: string;
      navigateTo: string;
    }>;

    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.title === "srchlib-task-shape-test");
    expect(found).toBeDefined();
    expect(found?.type).toBe("task");
    expect(found?.id).toBeDefined();
    expect(found?.subtitle).toBeDefined();
    expect(found?.navigateTo).toMatch(/\/workspaces\//);
  });
});

describe("search - note category with FTS5", () => {
  it("Test 3: returns note results with snippet field via FTS5 MATCH", async () => {
    const longContent = "FTS5content".repeat(10);
    const note = await testDb.projectNote.create({
      data: {
        title: "srchlib-fts5-note-title",
        content: longContent,
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await searchFn("srchlib-fts5-note", "note", defaultConfig) as Array<{
      id: string;
      type: string;
      snippet?: string;
    }>;

    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
    expect(found?.type).toBe("note");
    expect(found?.snippet).toBe(longContent.slice(0, 80));
  });
});

describe("search - note category with short query (LIKE fallback)", () => {
  it("Test 4: uses LIKE fallback for short query (< 3 chars)", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "AB Short Query Note",
        content: "some content here",
        projectId: testProjectId,
      },
    });
    // NOT synced to FTS — LIKE fallback queries ProjectNote table directly

    const results = await searchFn("ab", "note", defaultConfig) as Array<{ id: string }>;
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
  });
});

describe("search - all category", () => {
  it("Test 5: returns results from multiple types, each capped at allModeCap", async () => {
    // Create task
    await testDb.task.create({
      data: {
        title: "srchlib-all-task",
        projectId: testProjectId,
      },
    });

    // Create note and sync to FTS
    const note = await testDb.projectNote.create({
      data: {
        title: "srchlib-all-note",
        content: "srchlib all category content",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    // Create asset
    await testDb.projectAsset.create({
      data: {
        filename: "srchlib-all-file.txt",
        path: "/data/assets/srchlib-all-file.txt",
        size: 256,
        mimeType: "text/plain",
        description: "",
        projectId: testProjectId,
      },
    });

    const capConfig: SearchConfig = { resultLimit: 20, allModeCap: 3, snippetLength: 80 };
    const results = await searchFn("srchlib-all", "all", capConfig) as Array<{ type: string }>;
    expect(results.length).toBeGreaterThan(0);

    // Results from multiple types
    const types = new Set(results.map((r) => r.type));
    expect(types.size).toBeGreaterThan(1);

    // Each type capped at allModeCap (3)
    const taskResults = results.filter((r) => r.type === "task");
    const noteResults = results.filter((r) => r.type === "note");
    const assetResults = results.filter((r) => r.type === "asset");
    expect(taskResults.length).toBeLessThanOrEqual(3);
    expect(noteResults.length).toBeLessThanOrEqual(3);
    expect(assetResults.length).toBeLessThanOrEqual(3);
  });
});

describe("search - resultLimit config", () => {
  it("Test 6: respects resultLimit — creates 25 tasks, verifies result count <= 10", async () => {
    // Create 25 tasks matching the query
    const creations = Array.from({ length: 25 }, (_, i) =>
      testDb.task.create({
        data: {
          title: `srchlib-limit-task-${i.toString().padStart(3, "0")}`,
          projectId: testProjectId,
        },
      })
    );
    await Promise.all(creations);

    const limitConfig: SearchConfig = { resultLimit: 10, allModeCap: 5, snippetLength: 80 };
    const results = await searchFn("srchlib-limit-task", "task", limitConfig);
    expect(results.length).toBeLessThanOrEqual(10);
  });
});

describe("search - asset category", () => {
  it("Test 7: returns asset results with snippet from description", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "srchlib-asset-file.pdf",
        path: "/data/assets/srchlib-asset-file.pdf",
        size: 4096,
        mimeType: "application/pdf",
        description: "This is the asset description for search lib test",
        projectId: testProjectId,
      },
    });

    const results = await searchFn("srchlib-asset-file", "asset", defaultConfig) as Array<{
      id: string;
      type: string;
      title: string;
      snippet?: string;
    }>;

    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.title === "srchlib-asset-file.pdf");
    expect(found).toBeDefined();
    expect(found?.type).toBe("asset");
    expect(found?.snippet).toBe("This is the asset description for search lib test");
  });

  it("asset with empty description has undefined snippet", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "srchlib-no-desc.txt",
        path: "/data/assets/srchlib-no-desc.txt",
        size: 128,
        mimeType: "text/plain",
        description: "",
        projectId: testProjectId,
      },
    });

    const results = await searchFn("srchlib-no-desc", "asset", defaultConfig) as Array<{
      title: string;
      snippet?: string;
    }>;

    const found = results.find((r) => r.title === "srchlib-no-desc.txt");
    expect(found).toBeDefined();
    expect(found?.snippet).toBeUndefined();
  });
});

describe("search - module exports", () => {
  it("search module exports SearchConfig type (compile-time check via usage)", () => {
    const cfg: SearchConfig = { resultLimit: 20, allModeCap: 5, snippetLength: 80 };
    expect(cfg.resultLimit).toBe(20);
    expect(cfg.allModeCap).toBe(5);
    expect(cfg.snippetLength).toBe(80);
  });
});
