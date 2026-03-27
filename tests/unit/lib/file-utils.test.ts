// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// We'll use vi.spyOn on process.cwd() to redirect the data root to a temp dir
import { vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-utils-test-"));

// Mock process.cwd() before importing file-utils so DATA_ROOT resolves to tmpDir
vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

// Import after mocking cwd
import {
  getAssetsDir,
  getCacheDir,
  ensureAssetsDir,
  ensureCacheDir,
  listAssetFiles,
} from "@/lib/file-utils";

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  // Clean up data dir between tests
  const dataDir = path.join(tmpDir, "data");
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("getAssetsDir", () => {
  it("returns path ending in data/assets/{projectId}", () => {
    const result = getAssetsDir("proj123");
    expect(result).toMatch(/data[/\\]assets[/\\]proj123$/);
  });

  it("uses different ids for different projects", () => {
    const a = getAssetsDir("aaa");
    const b = getAssetsDir("bbb");
    expect(a).not.toBe(b);
    expect(a).toMatch(/aaa$/);
    expect(b).toMatch(/bbb$/);
  });
});

describe("getCacheDir", () => {
  it("returns path ending in data/cache/{taskId}", () => {
    const result = getCacheDir("task456");
    expect(result).toMatch(/data[/\\]cache[/\\]task456$/);
  });
});

describe("ensureAssetsDir", () => {
  it("creates the directory and returns the path", () => {
    const dir = ensureAssetsDir("proj123");
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir).toMatch(/data[/\\]assets[/\\]proj123$/);
  });

  it("is idempotent — does not throw if directory already exists", () => {
    ensureAssetsDir("proj123");
    expect(() => ensureAssetsDir("proj123")).not.toThrow();
  });
});

describe("ensureCacheDir", () => {
  it("creates the directory and returns the path", () => {
    const dir = ensureCacheDir("task456");
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir).toMatch(/data[/\\]cache[/\\]task456$/);
  });
});

describe("listAssetFiles", () => {
  it("returns empty array when directory does not exist", () => {
    const result = listAssetFiles("nonexistent");
    expect(result).toEqual([]);
  });

  it("returns filenames when directory has files", () => {
    const dir = ensureAssetsDir("proj-with-files");
    fs.writeFileSync(path.join(dir, "file1.png"), "data");
    fs.writeFileSync(path.join(dir, "file2.pdf"), "data");

    const result = listAssetFiles("proj-with-files");
    expect(result).toHaveLength(2);
    expect(result).toContain("file1.png");
    expect(result).toContain("file2.pdf");
  });

  it("returns empty array for a project with no files but existing dir", () => {
    ensureAssetsDir("empty-proj");
    const result = listAssetFiles("empty-proj");
    expect(result).toEqual([]);
  });
});
