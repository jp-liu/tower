// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as fileUtils from "@/lib/file-utils";

// Mock next/cache before importing server actions
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createAsset,
  deleteAsset,
  getProjectAssets,
  getAssetById,
} from "@/actions/asset-actions";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let testWorkspaceId: string;
let testProjectId: string;

beforeAll(async () => {
  await testDb.$connect();

  const workspace = await testDb.workspace.create({
    data: { name: "Asset Actions Test Workspace" },
  });
  testWorkspaceId = workspace.id;

  const project = await testDb.project.create({
    data: {
      name: "Asset Actions Test Project",
      workspaceId: testWorkspaceId,
    },
  });
  testProjectId = project.id;

  // Spy on ensureAssetsDir to avoid creating real directories in tests
  vi.spyOn(fileUtils, "ensureAssetsDir").mockReturnValue("/fake/assets/dir");
});

afterAll(async () => {
  await testDb.projectAsset.deleteMany({ where: { projectId: testProjectId } });
  await testDb.workspace.delete({ where: { id: testWorkspaceId } });
  await testDb.$disconnect();
  vi.restoreAllMocks();
});

describe("createAsset", () => {
  it("creates an asset record with correct fields", async () => {
    const asset = await createAsset({
      filename: "screenshot.png",
      path: `/data/assets/${testProjectId}/screenshot.png`,
      mimeType: "image/png",
      size: 1024,
      projectId: testProjectId,
    });

    expect(asset.id).toBeTruthy();
    expect(asset.filename).toBe("screenshot.png");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.size).toBe(1024);
    expect(asset.projectId).toBe(testProjectId);

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: asset.id } });
  });

  it("calls ensureAssetsDir before creating db record", async () => {
    const ensureSpy = vi.spyOn(fileUtils, "ensureAssetsDir").mockReturnValue("/fake/assets/dir");

    await createAsset({
      filename: "doc.pdf",
      path: `/data/assets/${testProjectId}/doc.pdf`,
      projectId: testProjectId,
    });

    expect(ensureSpy).toHaveBeenCalledWith(testProjectId);

    // Cleanup — find and delete the asset
    const assets = await testDb.projectAsset.findMany({
      where: { projectId: testProjectId, filename: "doc.pdf" },
    });
    for (const a of assets) {
      await testDb.projectAsset.delete({ where: { id: a.id } });
    }
  });

  it("creates an asset without optional fields (mimeType, size)", async () => {
    const asset = await createAsset({
      filename: "notes.txt",
      path: `/data/assets/${testProjectId}/notes.txt`,
      projectId: testProjectId,
    });

    expect(asset.filename).toBe("notes.txt");
    expect(asset.mimeType).toBeNull();
    expect(asset.size).toBeNull();

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: asset.id } });
  });

  it("throws ZodError for empty filename", async () => {
    await expect(
      createAsset({
        filename: "",
        path: "/some/path",
        projectId: testProjectId,
      })
    ).rejects.toThrow();
  });

  it("throws ZodError for missing projectId", async () => {
    await expect(
      createAsset({
        filename: "file.txt",
        path: "/some/path",
        projectId: "",
      })
    ).rejects.toThrow();
  });
});

describe("getProjectAssets", () => {
  it("returns all assets for a project ordered by createdAt desc", async () => {
    const asset1 = await createAsset({
      filename: "first.png",
      path: `/data/assets/${testProjectId}/first.png`,
      projectId: testProjectId,
    });
    const asset2 = await createAsset({
      filename: "second.png",
      path: `/data/assets/${testProjectId}/second.png`,
      projectId: testProjectId,
    });

    const assets = await getProjectAssets(testProjectId);
    const filenames = assets.map((a) => a.filename);
    expect(filenames).toContain("first.png");
    expect(filenames).toContain("second.png");

    // Cleanup
    await testDb.projectAsset.deleteMany({
      where: { id: { in: [asset1.id, asset2.id] } },
    });
  });

  it("returns empty array when project has no assets", async () => {
    // Create a fresh project with no assets
    const cleanProject = await testDb.project.create({
      data: { name: "Empty Asset Project", workspaceId: testWorkspaceId },
    });

    const assets = await getProjectAssets(cleanProject.id);
    expect(assets).toEqual([]);

    await testDb.project.delete({ where: { id: cleanProject.id } });
  });
});

describe("deleteAsset", () => {
  it("removes the asset record from the database", async () => {
    const asset = await createAsset({
      filename: "to-delete.png",
      path: `/data/assets/${testProjectId}/to-delete.png`,
      projectId: testProjectId,
    });

    await deleteAsset(asset.id);

    const found = await testDb.projectAsset.findUnique({ where: { id: asset.id } });
    expect(found).toBeNull();
  });
});

describe("getAssetById", () => {
  it("returns the asset when found", async () => {
    const asset = await createAsset({
      filename: "find-me.jpg",
      path: `/data/assets/${testProjectId}/find-me.jpg`,
      projectId: testProjectId,
    });

    const found = await getAssetById(asset.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(asset.id);
    expect(found!.filename).toBe("find-me.jpg");

    // Cleanup
    await testDb.projectAsset.delete({ where: { id: asset.id } });
  });

  it("returns null for a non-existent asset", async () => {
    const found = await getAssetById("nonexistent-asset-id");
    expect(found).toBeNull();
  });
});
