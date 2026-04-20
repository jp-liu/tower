import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import * as fs from "node:fs";
import { buildMultimodalPrompt } from "../build-multimodal-prompt";

const CACHE_DIR = "/abs/cache";

// Valid UUID v4 filenames for testing
const UUID1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890.png";
const UUID2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901.jpg";
const UUID3 = "c3d4e5f6-a7b8-9012-cdef-123456789012.webp";
const UUID_EXISTS = "d4e5f6a7-b8c9-0123-defa-234567890123.png";
const UUID_MISSING = "e5f6a7b8-c9d0-1234-efab-345678901234.jpg";

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
      [UUID1],
      CACHE_DIR
    );

    expect(result).toContain(`/abs/cache/${UUID1}`);
    expect(result).toContain("Read tool");
    expect(result).toContain("---");
  });

  it("appends all image paths when multiple images exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower compare",
      [UUID1, UUID2],
      CACHE_DIR
    );

    expect(result).toContain(`/abs/cache/${UUID1}`);
    expect(result).toContain(`/abs/cache/${UUID2}`);
  });

  it("skips files that do not exist on disk", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = buildMultimodalPrompt(
      "/tower hi",
      [UUID1],
      CACHE_DIR
    );

    // No valid paths → returns prompt unchanged
    expect(result).toBe("/tower hi");
  });

  it("returns prompt unchanged when all files are missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = buildMultimodalPrompt(
      "/tower test",
      [UUID1, UUID2, UUID3],
      CACHE_DIR
    );

    expect(result).toBe("/tower test");
    expect(result).not.toContain("---");
  });

  it("includes only existing files when some are missing", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(UUID_EXISTS);
    });

    const result = buildMultimodalPrompt(
      "/tower mixed",
      [UUID_EXISTS, UUID_MISSING],
      CACHE_DIR
    );

    expect(result).toContain(`/abs/cache/${UUID_EXISTS}`);
    expect(result).not.toContain(UUID_MISSING);
  });

  it("caps at 10 images — excess silently dropped", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const manyImages = Array.from(
      { length: 15 },
      (_, i) => `a0b1c2d3-e4f5-6789-abcd-${String(i).padStart(12, "0")}.png`
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
      [UUID1],
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
      ["../../etc/passwd", "../.env", UUID1],
      CACHE_DIR
    );

    // Only the valid UUID filename should appear
    expect(result).toContain(UUID1);
    expect(result).not.toContain("passwd");
    expect(result).not.toContain(".env");
  });

  it("rejects filenames that don't match UUID format", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = buildMultimodalPrompt(
      "/tower strict",
      ["not-a-uuid.png", "abc.jpg", UUID1],
      CACHE_DIR
    );

    expect(result).toContain(UUID1);
    expect(result).not.toContain("not-a-uuid");
    expect(result).not.toContain("abc.jpg");
  });
});
