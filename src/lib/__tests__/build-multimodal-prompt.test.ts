import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import * as fs from "node:fs";
import { buildMultimodalPrompt } from "../build-multimodal-prompt";

const CACHE_DIR = "/abs/cache/assistant";

// Valid sub-path format filenames for testing
const SUBPATH1 = "2026-04/images/design-a1b2c3d4.png";
const SUBPATH2 = "2026-04/images/photo-b2c3d4e5.jpg";
const SUBPATH3 = "2025-12/images/test-c3d4e5f6.webp";
const SUBPATH_EXISTS = "2026-04/images/exists-d4e5f6a7.png";
const SUBPATH_MISSING = "2026-04/images/missing-e5f6a7b8.jpg";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buildMultimodalPrompt", () => {
  it("returns prompt unchanged when imageFilenames is empty", () => {
    const result = buildMultimodalPrompt("/tower hello", [], CACHE_DIR);
    expect(result).toBe("/tower hello");
  });

  it("appends image path section for a single existing image", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower describe this",
      [SUBPATH1],
      CACHE_DIR
    );

    expect(result).toContain(`/abs/cache/assistant/${SUBPATH1}`);
    expect(result).toContain("Read tool");
    expect(result).toContain("---");
  });

  it("appends all image paths when multiple images exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower compare",
      [SUBPATH1, SUBPATH2],
      CACHE_DIR
    );

    expect(result).toContain(`/abs/cache/assistant/${SUBPATH1}`);
    expect(result).toContain(`/abs/cache/assistant/${SUBPATH2}`);
  });

  it("skips files that do not exist on disk", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = buildMultimodalPrompt(
      "/tower hi",
      [SUBPATH1],
      CACHE_DIR
    );

    // No valid paths → returns prompt unchanged
    expect(result).toBe("/tower hi");
  });

  it("returns prompt unchanged when all files are missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = buildMultimodalPrompt(
      "/tower test",
      [SUBPATH1, SUBPATH2, SUBPATH3],
      CACHE_DIR
    );

    expect(result).toBe("/tower test");
    expect(result).not.toContain("---");
  });

  it("includes only existing files when some are missing", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes("exists-d4e5f6a7");
    });

    const result = buildMultimodalPrompt(
      "/tower mixed",
      [SUBPATH_EXISTS, SUBPATH_MISSING],
      CACHE_DIR
    );

    expect(result).toContain(`/abs/cache/assistant/${SUBPATH_EXISTS}`);
    expect(result).not.toContain("missing-e5f6a7b8");
  });

  it("caps at 10 images — excess silently dropped", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const manyImages = Array.from(
      { length: 15 },
      (_, i) => `2026-04/images/img-${String(i).padStart(8, "0")}.png`
    );
    const result = buildMultimodalPrompt("/tower many", manyImages, CACHE_DIR);

    // Only first 10 should appear
    for (let i = 0; i < 10; i++) {
      expect(result).toContain(manyImages[i]);
    }
    // Images 10–14 should not appear
    for (let i = 10; i < 15; i++) {
      expect(result).not.toContain(manyImages[i]);
    }
  });

  it("uses a clear delimiter section so Claude knows where image references start", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower check",
      [SUBPATH1],
      CACHE_DIR
    );

    // Should have the delimiter and the instruction text
    expect(result).toContain("\n\n---\n");
    expect(result).toMatch(/attached.*image/i);
  });

  it("rejects filenames with path traversal sequences", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower safe",
      ["../../etc/passwd", "../.env", SUBPATH1],
      CACHE_DIR
    );

    // Only the valid sub-path filename should appear
    expect(result).toContain(SUBPATH1);
    expect(result).not.toContain("passwd");
    expect(result).not.toContain(".env");
  });

  it("rejects filenames that don't match sub-path format", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower strict",
      ["not-valid.png", "abc.jpg", SUBPATH1],
      CACHE_DIR
    );

    expect(result).toContain(SUBPATH1);
    expect(result).not.toContain("not-valid");
    expect(result).not.toContain("abc.jpg");
  });

  it("accepts sub-paths with Chinese characters", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const chineseSubPath = "2026-04/images/\u8bbe\u8ba1\u7a3f-a1b2c3d4.png";
    const result = buildMultimodalPrompt(
      "/tower check chinese",
      [chineseSubPath],
      CACHE_DIR
    );

    expect(result).toContain(chineseSubPath);
    expect(result).toContain("Read tool");
  });
});
