import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    projectAsset: {
      create: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    promises: { unlink: vi.fn(), writeFile: vi.fn() },
    mkdirSync: vi.fn(),
  };
});
vi.mock("@/lib/file-utils", () => ({
  ensureAssetsDir: vi.fn(() => "/mock/assets/dir"),
}));
vi.mock("@/actions/config-actions", () => ({
  getConfigValue: vi.fn(async () => 52428800), // 50MB default
}));

import { db } from "@/lib/db";
import * as fs from "node:fs";
import { revalidatePath } from "next/cache";
import { ensureAssetsDir } from "@/lib/file-utils";
import { getConfigValue } from "@/actions/config-actions";
import {
  createAsset,
  deleteAsset,
  getProjectAssets,
  getTaskAssets,
  getAssetById,
  uploadAsset,
} from "@/actions/asset-actions";

const mockDb = db as {
  projectAsset: {
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  project: { findUnique: ReturnType<typeof vi.fn> };
};

function makeFormData(
  overrides: { file?: object | null; projectId?: string | null; taskId?: string; description?: string } = {}
): FormData {
  const fd = {
    get: vi.fn((key: string) => {
      if (key === "file") return "file" in overrides ? overrides.file : makeFile("test.txt", 100);
      if (key === "projectId") return "projectId" in overrides ? overrides.projectId : "proj123";
      if (key === "taskId") return overrides.taskId ?? null;
      if (key === "description") return overrides.description ?? null;
      return null;
    }),
  } as unknown as FormData;
  return fd;
}

function makeFile(name: string, size: number, type = "text/plain") {
  return {
    name,
    size,
    type,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(size)),
  };
}

describe("asset-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createAsset ──────────────────────────────────────────────────────────

  describe("createAsset", () => {
    it("creates an asset and revalidates path", async () => {
      const fakeAsset = { id: "a1", filename: "file.txt", path: "/p/file.txt", projectId: "proj123" };
      mockDb.projectAsset.create.mockResolvedValue(fakeAsset);

      const result = await createAsset({
        filename: "file.txt",
        path: "/p/file.txt",
        projectId: "proj123",
      });

      expect(mockDb.projectAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ filename: "file.txt", projectId: "proj123" }) })
      );
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
      expect(result).toBe(fakeAsset);
    });

    it("throws on empty filename (schema validation)", async () => {
      await expect(
        createAsset({ filename: "", path: "/p/file.txt", projectId: "proj123" })
      ).rejects.toThrow();

      expect(mockDb.projectAsset.create).not.toHaveBeenCalled();
    });
  });

  // ── deleteAsset ──────────────────────────────────────────────────────────

  describe("deleteAsset", () => {
    it("calls unlink when asset has a path, then deletes from DB", async () => {
      const fakeAsset = { id: "a1", path: "/some/file.txt" };
      mockDb.projectAsset.findUnique.mockResolvedValue(fakeAsset);
      (fs.promises.unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      mockDb.projectAsset.delete.mockResolvedValue(fakeAsset);

      await deleteAsset("a1");

      expect(fs.promises.unlink).toHaveBeenCalledWith("/some/file.txt");
      expect(mockDb.projectAsset.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
      expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    });

    it("skips unlink when asset path is null, still deletes from DB", async () => {
      const fakeAsset = { id: "a2", path: null };
      mockDb.projectAsset.findUnique.mockResolvedValue(fakeAsset);
      mockDb.projectAsset.delete.mockResolvedValue(fakeAsset);

      await deleteAsset("a2");

      expect(fs.promises.unlink).not.toHaveBeenCalled();
      expect(mockDb.projectAsset.delete).toHaveBeenCalledWith({ where: { id: "a2" } });
    });
  });

  // ── getProjectAssets ─────────────────────────────────────────────────────

  describe("getProjectAssets", () => {
    it("queries with projectId (includes all assets)", async () => {
      mockDb.projectAsset.findMany.mockResolvedValue([]);

      await getProjectAssets("proj123");

      expect(mockDb.projectAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: "proj123" } })
      );
    });
  });

  // ── getTaskAssets ────────────────────────────────────────────────────────

  describe("getTaskAssets", () => {
    it("queries with taskId filter", async () => {
      mockDb.projectAsset.findMany.mockResolvedValue([]);

      await getTaskAssets("task456");

      expect(mockDb.projectAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: "task456" } })
      );
    });
  });

  // ── getAssetById ─────────────────────────────────────────────────────────

  describe("getAssetById", () => {
    it("calls findUnique with the given assetId", async () => {
      const fakeAsset = { id: "a1" };
      mockDb.projectAsset.findUnique.mockResolvedValue(fakeAsset);

      const result = await getAssetById("a1");

      expect(mockDb.projectAsset.findUnique).toHaveBeenCalledWith({ where: { id: "a1" } });
      expect(result).toBe(fakeAsset);
    });
  });

  // ── uploadAsset ──────────────────────────────────────────────────────────

  describe("uploadAsset", () => {
    it("happy path: writes file and creates asset", async () => {
      const fakeProject = { id: "proj123" };
      const fakeAsset = { id: "a1", filename: "test.txt", projectId: "proj123" };
      mockDb.project.findUnique.mockResolvedValue(fakeProject);
      mockDb.projectAsset.create.mockResolvedValue(fakeAsset);
      (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const fd = makeFormData({ file: makeFile("test.txt", 100) });
      const result = await uploadAsset(fd);

      expect(ensureAssetsDir).toHaveBeenCalledWith("proj123");
      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(mockDb.projectAsset.create).toHaveBeenCalled();
      expect(result).toBe(fakeAsset);
    });

    it("throws when file is missing from FormData", async () => {
      const fd = makeFormData({ file: null });

      await expect(uploadAsset(fd)).rejects.toThrow("Missing file or projectId");
    });

    it("throws when projectId is missing from FormData", async () => {
      const fd = makeFormData({ projectId: null });

      await expect(uploadAsset(fd)).rejects.toThrow("Missing file or projectId");
    });

    it("throws when file is too large", async () => {
      // getConfigValue returns 100 bytes max
      (getConfigValue as ReturnType<typeof vi.fn>).mockResolvedValue(100);
      const largeFile = makeFile("big.bin", 200);
      const fd = makeFormData({ file: largeFile });

      await expect(uploadAsset(fd)).rejects.toThrow(/File too large/);
    });

    it("throws when projectId is invalid (not in DB)", async () => {
      mockDb.project.findUnique.mockResolvedValue(null);
      const fd = makeFormData({ file: makeFile("test.txt", 10) });

      await expect(uploadAsset(fd)).rejects.toThrow("Invalid projectId");
    });

    it("sanitizes filename with path traversal attempt", async () => {
      const fakeProject = { id: "proj123" };
      const fakeAsset = { id: "a1", filename: "passwd", projectId: "proj123" };
      mockDb.project.findUnique.mockResolvedValue(fakeProject);
      mockDb.projectAsset.create.mockResolvedValue(fakeAsset);
      (fs.promises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      // file named with path traversal: path.basename should strip to "passwd"
      const traversalFile = makeFile("../../../etc/passwd", 10);
      const fd = makeFormData({ file: traversalFile });

      const result = await uploadAsset(fd);

      // Verify writeFile was called — the asset was created (not thrown)
      expect(fs.promises.writeFile).toHaveBeenCalled();
      // Verify the create call used the sanitized filename (basename only)
      const createCall = mockDb.projectAsset.create.mock.calls[0][0];
      expect(createCall.data.filename).toBe("passwd");
      expect(result).toBe(fakeAsset);
    });
  });
});
