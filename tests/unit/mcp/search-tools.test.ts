// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncNoteToFts } from "@/lib/fts";
import { z } from "zod";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let searchHandler: (args: any) => Promise<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let searchSchema: z.ZodObject<any>;

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
    data: { name: "Search Tools MCP Test WS" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Search Tools MCP Test Proj",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;

  // Dynamically import search-tools
  const mod = await import("@/mcp/tools/search-tools");
  searchHandler = mod.searchTools.search.handler;
  searchSchema = mod.searchTools.search.schema;
});

afterAll(async () => {
  await testDb.workspace.delete({ where: { id: testWorkspaceId } });
  await testDb.$disconnect();
});

afterEach(async () => {
  // Clean up notes + FTS
  const notes = await testDb.projectNote.findMany({
    where: { projectId: testProjectId },
  });
  for (const note of notes) {
    await testDb.$executeRawUnsafe("DELETE FROM notes_fts WHERE note_id = ?", note.id);
  }
  await testDb.projectNote.deleteMany({ where: { projectId: testProjectId } });

  // Clean up assets
  await testDb.projectAsset.deleteMany({ where: { projectId: testProjectId } });
});

describe("search tool schema validation", () => {
  it("accepts category 'note'", () => {
    expect(() => searchSchema.parse({ query: "test", category: "note" })).not.toThrow();
  });

  it("accepts category 'asset'", () => {
    expect(() => searchSchema.parse({ query: "test", category: "asset" })).not.toThrow();
  });

  it("accepts category 'all'", () => {
    expect(() => searchSchema.parse({ query: "test", category: "all" })).not.toThrow();
  });

  it("accepts existing category 'task'", () => {
    expect(() => searchSchema.parse({ query: "test", category: "task" })).not.toThrow();
  });

  it("accepts existing category 'project'", () => {
    expect(() => searchSchema.parse({ query: "test", category: "project" })).not.toThrow();
  });

  it("accepts existing category 'repository'", () => {
    expect(() => searchSchema.parse({ query: "test", category: "repository" })).not.toThrow();
  });

  it("rejects invalid category", () => {
    expect(() => searchSchema.parse({ query: "test", category: "invalid" })).toThrow();
  });
});

describe("search tool handler - note category", () => {
  it("returns results matching note title", async () => {
    const note = await testDb.projectNote.create({
      data: {
        title: "MCP API Documentation",
        content: "This covers MCP API details",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    const results = await searchHandler({ query: "MCP API", category: "note" }) as Array<{ id: string; type: string }>;
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === note.id);
    expect(found).toBeDefined();
    expect(found?.type).toBe("note");
  });

  it("returns empty array for query with no matches", async () => {
    const results = await searchHandler({ query: "zzz_no_match_12345", category: "note" }) as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([]);
  });
});

describe("search tool handler - asset category", () => {
  it("returns results matching asset filename", async () => {
    await testDb.projectAsset.create({
      data: {
        filename: "mcp-asset-readme.md",
        path: "/data/assets/mcp-asset-readme.md",
        size: 1024,
        mimeType: "text/markdown",
        description: "asset for MCP test",
        projectId: testProjectId,
      },
    });

    const results = await searchHandler({ query: "mcp-asset-readme", category: "asset" }) as Array<{ title: string; type: string }>;
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.title === "mcp-asset-readme.md");
    expect(found).toBeDefined();
    expect(found?.type).toBe("asset");
  });

  it("returns empty array for asset query with no matches", async () => {
    const results = await searchHandler({ query: "zzz_no_match_asset_12345", category: "asset" }) as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([]);
  });
});

describe("search tool handler - all category", () => {
  it("returns results from multiple types", async () => {
    // Create note with common search term
    const note = await testDb.projectNote.create({
      data: {
        title: "mcpall-search-note",
        content: "mcpall content here",
        projectId: testProjectId,
      },
    });
    await syncNoteToFts(testDb, { id: note.id, title: note.title, content: note.content });

    // Create asset with same term
    await testDb.projectAsset.create({
      data: {
        filename: "mcpall-file.txt",
        path: "/data/assets/mcpall-file.txt",
        size: 256,
        mimeType: "text/plain",
        description: "",
        projectId: testProjectId,
      },
    });

    const results = await searchHandler({ query: "mcpall", category: "all" }) as Array<{ type: string }>;
    expect(results.length).toBeGreaterThan(0);

    const types = new Set(results.map((r) => r.type));
    expect(types.size).toBeGreaterThan(1);
  });
});
