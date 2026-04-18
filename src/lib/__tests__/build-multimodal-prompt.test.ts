import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import * as fs from "node:fs";
import { buildMultimodalPrompt } from "../build-multimodal-prompt";

const CACHE_DIR = "/abs/cache";

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
      ["abc.png"],
      CACHE_DIR
    );

    expect(result).toContain("/abs/cache/abc.png");
    expect(result).toContain("Read tool");
    expect(result).toContain("---");
  });

  it("appends all image paths when multiple images exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower compare",
      ["a.png", "b.jpg"],
      CACHE_DIR
    );

    expect(result).toContain("/abs/cache/a.png");
    expect(result).toContain("/abs/cache/b.jpg");
  });

  it("skips files that do not exist on disk", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = buildMultimodalPrompt(
      "/tower hi",
      ["missing.png"],
      CACHE_DIR
    );

    // No valid paths → returns prompt unchanged
    expect(result).toBe("/tower hi");
  });

  it("returns prompt unchanged when all files are missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = buildMultimodalPrompt(
      "/tower test",
      ["a.png", "b.png", "c.jpg"],
      CACHE_DIR
    );

    expect(result).toBe("/tower test");
    expect(result).not.toContain("---");
  });

  it("includes only existing files when some are missing", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes("exists.png");
    });

    const result = buildMultimodalPrompt(
      "/tower mixed",
      ["exists.png", "missing.jpg"],
      CACHE_DIR
    );

    expect(result).toContain("/abs/cache/exists.png");
    expect(result).not.toContain("missing.jpg");
  });

  it("caps at 10 images — excess silently dropped", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const manyImages = Array.from({ length: 15 }, (_, i) => `img${i}.png`);
    const result = buildMultimodalPrompt("/tower many", manyImages, CACHE_DIR);

    // Only first 10 should appear
    for (let i = 0; i < 10; i++) {
      expect(result).toContain(`img${i}.png`);
    }
    // Images 10–14 should not appear
    for (let i = 10; i < 15; i++) {
      expect(result).not.toContain(`img${i}.png`);
    }
  });

  it("uses a clear delimiter section so Claude knows where image references start", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower check",
      ["image.png"],
      CACHE_DIR
    );

    // Should have the delimiter and the instruction text
    expect(result).toContain("\n\n---\n");
    expect(result).toMatch(/attached.*image/i);
  });
});
