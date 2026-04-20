import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs so mkdirSync doesn't create real directories
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

import * as fs from "node:fs";
import {
  getAssistantCacheDir,
  buildCacheFilename,
  stripCacheUuidSuffix,
  isAssistantCachePath,
} from "../file-utils";

describe("getAssistantCacheDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DIR-01: returns path ending with YYYY-MM/images when called with 'images'", () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const result = getAssistantCacheDir("images");
    expect(result).toMatch(new RegExp(`assistant[\\/\\\\]${ym}[\\/\\\\]images$`));
  });

  it("DIR-02: returns path ending with YYYY-MM/files when called with 'files'", () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const result = getAssistantCacheDir("files");
    expect(result).toMatch(new RegExp(`assistant[\\/\\\\]${ym}[\\/\\\\]files$`));
  });

  it("DIR-02: defaults to 'images' type when called with no arguments", () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const result = getAssistantCacheDir();
    expect(result).toMatch(new RegExp(`assistant[\\/\\\\]${ym}[\\/\\\\]images$`));
  });

  it("DIR-03: calls fs.mkdirSync with { recursive: true }", () => {
    getAssistantCacheDir("images");
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true }
    );
  });

  it("DIR-03: mkdirSync receives the same path returned by the function", () => {
    const result = getAssistantCacheDir("images");
    expect(fs.mkdirSync).toHaveBeenCalledWith(result, { recursive: true });
  });
});

describe("buildCacheFilename", () => {
  it("NAME-01: preserves Chinese characters in filename", () => {
    const result = buildCacheFilename("设计稿.png", ".png");
    expect(result).toMatch(/^设计稿-[0-9a-f]{8}\.png$/);
  });

  it("NAME-01 + NAME-03: replaces spaces with underscore, keeps alphanumeric", () => {
    const result = buildCacheFilename("my report.pdf", ".pdf");
    expect(result).toMatch(/^my_report-[0-9a-f]{8}\.pdf$/);
  });

  it("NAME-02: returns tower_image prefix for meaningless name 'image'", () => {
    const result = buildCacheFilename("image.png", ".png");
    expect(result).toMatch(/^tower_image-[0-9a-f]{8}\.png$/);
  });

  it("NAME-02: returns tower_image prefix for Screenshot-style names", () => {
    const result = buildCacheFilename("Screenshot 2026-04-20 at 12.34.56.png", ".png");
    expect(result).toMatch(/^tower_image-[0-9a-f]{8}\.png$/);
  });

  it("NAME-02: returns tower_image prefix for empty original name", () => {
    const result = buildCacheFilename("", ".png");
    expect(result).toMatch(/^tower_image-[0-9a-f]{8}\.png$/);
  });

  it("NAME-03: replaces special characters with underscore", () => {
    const result = buildCacheFilename("hello world!@#.png", ".png");
    expect(result).toMatch(/^hello_world-[0-9a-f]{8}\.png$/);
  });

  it("NAME-03: preserves Chinese characters and replaces spaces with underscore", () => {
    const result = buildCacheFilename("中文 文件名.png", ".png");
    expect(result).toMatch(/^中文_文件名-[0-9a-f]{8}\.png$/);
  });

  it("NAME-03: falls back to 'file' prefix when stem is all special chars", () => {
    const result = buildCacheFilename("!!!.png", ".png");
    expect(result).toMatch(/^file-[0-9a-f]{8}\.png$/);
  });

  it("appends exactly 8 hex characters as UUID suffix", () => {
    const result = buildCacheFilename("test.png", ".png");
    const match = result.match(/-([0-9a-f]{8})\./);
    expect(match).not.toBeNull();
    expect(match![1]).toHaveLength(8);
  });

  it("uses the provided extension correctly", () => {
    const result = buildCacheFilename("document.pdf", ".pdf");
    expect(result).toMatch(/\.pdf$/);
  });

  it("NAME-02: 'img' is also a meaningless name", () => {
    const result = buildCacheFilename("img.jpg", ".jpg");
    expect(result).toMatch(/^tower_image-[0-9a-f]{8}\.jpg$/);
  });

  it("NAME-02: 'photo' is also a meaningless name", () => {
    const result = buildCacheFilename("photo.jpg", ".jpg");
    expect(result).toMatch(/^tower_image-[0-9a-f]{8}\.jpg$/);
  });
});

describe("stripCacheUuidSuffix", () => {
  it("ASSET-01: strips 8-hex UUID suffix from Chinese filename", () => {
    expect(stripCacheUuidSuffix("设计稿-a1b2c3d4.png")).toBe("设计稿.png");
  });

  it("ASSET-01: strips 8-hex UUID suffix from tower_image filename", () => {
    expect(stripCacheUuidSuffix("tower_image-a1b2c3d4.png")).toBe("tower_image.png");
  });

  it("ASSET-01: returns filename unchanged when no 8-hex suffix present", () => {
    expect(stripCacheUuidSuffix("already-clean.png")).toBe("already-clean.png");
  });

  it("ASSET-01: does not strip when hex part is 12 chars (not 8)", () => {
    expect(stripCacheUuidSuffix("report-a1b2c3d4e5f6.png")).toBe("report-a1b2c3d4e5f6.png");
  });

  it("ASSET-01: strips case-insensitive hex suffix (uppercase)", () => {
    expect(stripCacheUuidSuffix("my_doc-AABB1122.pdf")).toBe("my_doc.pdf");
  });

  it("ASSET-01: handles different file extensions correctly", () => {
    expect(stripCacheUuidSuffix("document-deadbeef.pdf")).toBe("document.pdf");
  });
});

describe("isAssistantCachePath", () => {
  it("ASSET-01: returns true for path inside assistant cache root", () => {
    const cacheRoot = require("path").join(process.cwd(), "data", "cache", "assistant");
    const filePath = require("path").join(cacheRoot, "2026-04", "images", "foo.png");
    expect(isAssistantCachePath(filePath)).toBe(true);
  });

  it("ASSET-01: returns false for path outside assistant cache (in assets)", () => {
    const assetsPath = require("path").join(process.cwd(), "data", "assets", "proj123", "foo.png");
    expect(isAssistantCachePath(assetsPath)).toBe(false);
  });

  it("ASSET-01: returns false for arbitrary non-cache path", () => {
    expect(isAssistantCachePath("/tmp/some/random/file.png")).toBe(false);
  });
});
