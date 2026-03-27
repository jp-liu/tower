// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mock node:fs before importing the module under test
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 1234 })),
    mkdirSync: vi.fn(),
  };
});

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let manageAssetsHandler: (args: any) => Promise<unknown>;

beforeAll(async () => {
  await testDb.$connect();

  const workspace = await testDb.workspace.create({
    data: { name: "Manage Assets MCP Test Workspace" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Manage Assets MCP Test Project",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;

  const mod = await import("@/mcp/tools/note-asset-tools");
  manageAssetsHandler = mod.noteAssetTools.manage_assets.handler;
});

afterAll(async () => {
  // Clean up test assets from DB
  await testDb.projectAsset.deleteMany({ where: { projectId: testProjectId } });
  await testDb.workspace.delete({ where: { id: testWorkspaceId } });
  await testDb.$disconnect();
});

describe("manage_assets action=add", () => {
  it("calls renameSync with correct src/dest and creates DB record", async () => {
    const { renameSync } = await import("node:fs");
    vi.mocked(renameSync).mockClear();

    const result = await manageAssetsHandler({
      action: "add",
      projectId: testProjectId,
      sourcePath: "/tmp/myfile.pdf",
    }) as { id: string; filename: string; path: string; size: number; projectId: string };

    expect(renameSync).toHaveBeenCalledOnce();
    const [src, dest] = vi.mocked(renameSync).mock.calls[0];
    expect(src).toBe("/tmp/myfile.pdf");
    expect(String(dest)).toContain("myfile.pdf");
    expect(String(dest)).toContain(testProjectId);

    expect(result.filename).toBe("myfile.pdf");
    expect(result.size).toBe(1234);
    expect(result.projectId).toBe(testProjectId);
    expect(result.id).toBeDefined();

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: result.id } });
  });

  it("uses custom filename when provided", async () => {
    const { renameSync } = await import("node:fs");
    vi.mocked(renameSync).mockClear();

    const result = await manageAssetsHandler({
      action: "add",
      projectId: testProjectId,
      sourcePath: "/tmp/something.txt",
      filename: "custom-name.txt",
    }) as { id: string; filename: string; path: string };

    const [, dest] = vi.mocked(renameSync).mock.calls[0];
    expect(String(dest)).toContain("custom-name.txt");
    expect(result.filename).toBe("custom-name.txt");

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: result.id } });
  });

  it("falls back to copyFileSync + unlinkSync on EXDEV error", async () => {
    const { renameSync, copyFileSync, unlinkSync } = await import("node:fs");
    vi.mocked(renameSync).mockImplementationOnce(() => {
      const err = new Error("EXDEV cross-device link") as NodeJS.ErrnoException;
      err.code = "EXDEV";
      throw err;
    });
    vi.mocked(copyFileSync).mockClear();
    vi.mocked(unlinkSync).mockClear();

    const result = await manageAssetsHandler({
      action: "add",
      projectId: testProjectId,
      sourcePath: "/tmp/crossdevice.bin",
    }) as { id: string; filename: string };

    expect(copyFileSync).toHaveBeenCalledOnce();
    expect(unlinkSync).toHaveBeenCalledOnce();
    expect(result.filename).toBe("crossdevice.bin");

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: result.id } });
  });

  it("throws when projectId is missing", async () => {
    await expect(
      manageAssetsHandler({ action: "add", sourcePath: "/tmp/file.txt" })
    ).rejects.toThrow("projectId and sourcePath required");
  });

  it("throws when sourcePath is missing", async () => {
    await expect(
      manageAssetsHandler({ action: "add", projectId: testProjectId })
    ).rejects.toThrow("projectId and sourcePath required");
  });
});

describe("manage_assets action=list", () => {
  it("returns assets for a project ordered by createdAt desc", async () => {
    // Create two assets with a small delay to ensure distinct createdAt timestamps
    const a1 = await testDb.projectAsset.create({
      data: { filename: "first.txt", path: "/data/assets/p/first.txt", size: 100, projectId: testProjectId },
    });
    await new Promise((r) => setTimeout(r, 10));
    const a2 = await testDb.projectAsset.create({
      data: { filename: "second.txt", path: "/data/assets/p/second.txt", size: 200, projectId: testProjectId },
    });

    const results = await manageAssetsHandler({
      action: "list",
      projectId: testProjectId,
    }) as Array<{ id: string; filename: string }>;

    expect(results.length).toBeGreaterThanOrEqual(2);
    // Most recently created should be first
    expect(results[0].filename).toBe("second.txt");

    // Cleanup
    await testDb.projectAsset.deleteMany({ where: { id: { in: [a1.id, a2.id] } } });
  });
});

describe("manage_assets action=get", () => {
  it("returns a single asset by ID", async () => {
    const asset = await testDb.projectAsset.create({
      data: { filename: "getme.txt", path: "/data/assets/p/getme.txt", size: 42, projectId: testProjectId },
    });

    const result = await manageAssetsHandler({
      action: "get",
      assetId: asset.id,
    }) as { id: string; filename: string };

    expect(result.id).toBe(asset.id);
    expect(result.filename).toBe("getme.txt");

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: asset.id } });
  });
});

describe("manage_assets action=delete", () => {
  it("deletes the DB record", async () => {
    const asset = await testDb.projectAsset.create({
      data: { filename: "todelete.txt", path: "/data/assets/p/todelete.txt", size: 10, projectId: testProjectId },
    });

    const result = await manageAssetsHandler({
      action: "delete",
      assetId: asset.id,
    }) as { deleted: boolean; assetId: string };

    expect(result.deleted).toBe(true);
    expect(result.assetId).toBe(asset.id);

    const found = await testDb.projectAsset.findUnique({ where: { id: asset.id } });
    expect(found).toBeNull();
  });
});
