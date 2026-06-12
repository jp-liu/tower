// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// Each test run gets an isolated TOWER_DATA_DIR so getTowerDir()/getStorageDir()
// resolve under a temp tree. Must be set before importing the modules under test.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "tower-storage-test-"));
process.env.TOWER_DATA_DIR = path.join(TMP_ROOT, "data");
delete process.env.TOWER_STORAGE_DIR;

vi.mock("@/lib/db", () => ({
  db: { projectAsset: { findMany: vi.fn(), update: vi.fn() } },
}));

import { db } from "@/lib/db";
import { setStorageLocation, getStorageLocation } from "@/actions/storage-actions";
import { getStorageDir, getDefaultStorageDir, writeStoragePointer } from "@/lib/tower-dir";

const mockDb = db as unknown as {
  projectAsset: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.projectAsset.findMany.mockResolvedValue([]);
  mockDb.projectAsset.update.mockResolvedValue({});
  // Reset to default storage before each test.
  writeStoragePointer(null);
});

afterEach(() => {
  // Clean any custom storage dirs created under TMP_ROOT (except the data dir).
  for (const entry of fs.readdirSync(TMP_ROOT)) {
    if (entry !== "data") fs.rmSync(path.join(TMP_ROOT, entry), { recursive: true, force: true });
  }
  const storage = getDefaultStorageDir();
  fs.rmSync(storage, { recursive: true, force: true });
  writeStoragePointer(null);
});

describe("setStorageLocation", () => {
  it("moves files, rewrites ProjectAsset paths, and updates the effective location", async () => {
    const oldDir = getStorageDir(); // default ~/.tower/storage (under temp)
    // Seed an asset file in the old location.
    const assetDir = path.join(oldDir, "assets", "proj1");
    fs.mkdirSync(assetDir, { recursive: true });
    const oldAssetPath = path.join(assetDir, "design.png");
    fs.writeFileSync(oldAssetPath, "PNG");

    mockDb.projectAsset.findMany.mockResolvedValue([
      { id: "a1", path: oldAssetPath },
      { id: "a2", path: "/somewhere/else/unrelated.png" }, // outside storage — must NOT change
    ]);

    const newDir = path.join(TMP_ROOT, "moved-storage");
    const res = await setStorageLocation({ newPath: newDir });

    expect(res.ok).toBe(true);
    expect(res.moved).toBe(1);
    // File physically moved.
    expect(fs.existsSync(path.join(newDir, "assets", "proj1", "design.png"))).toBe(true);
    expect(fs.existsSync(oldAssetPath)).toBe(false);
    // Only the in-storage asset row was rewritten.
    expect(mockDb.projectAsset.update).toHaveBeenCalledTimes(1);
    expect(mockDb.projectAsset.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { path: path.join(newDir, "assets", "proj1", "design.png") },
    });
    // Effective location now points at the new dir.
    expect(getStorageDir()).toBe(newDir);
    const loc = await getStorageLocation();
    expect(loc.current).toBe(newDir);
    expect(loc.isDefault).toBe(false);
  });

  it("rejects a non-empty target directory", async () => {
    const newDir = path.join(TMP_ROOT, "occupied");
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "existing.txt"), "x");

    const res = await setStorageLocation({ newPath: newDir });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("rejects nesting the new path inside the current storage dir", async () => {
    const nested = path.join(getStorageDir(), "child");
    const res = await setStorageLocation({ newPath: nested });
    expect(res.ok).toBe(false);
  });

  it("clears the override when relocating back to the default", async () => {
    const newDir = path.join(TMP_ROOT, "tmp-storage");
    await setStorageLocation({ newPath: newDir });
    expect((await getStorageLocation()).isDefault).toBe(false);

    const res = await setStorageLocation({ newPath: getDefaultStorageDir() });
    expect(res.ok).toBe(true);
    expect((await getStorageLocation()).isDefault).toBe(true);
  });
});
