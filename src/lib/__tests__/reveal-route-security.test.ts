/**
 * Security tests for /api/internal/assets/reveal
 *
 * Tests that the reveal API only allows paths within storage/assets/.
 * The actual route resolves paths relative to getStorageDir() (~/.tower/storage/).
 */
import { describe, it, expect } from "vitest";
import * as path from "path";

describe("Reveal Route Path Containment", () => {
  // Extracted path containment logic from the route for unit testing.
  // dataRoot simulates getStorageDir() return value.
  function isRevealAllowed(bodyPath: string, dataRoot: string): boolean {
    const resolvedPath = path.resolve(dataRoot, bodyPath);
    const assetsRoot = path.resolve(dataRoot, "assets/");
    return (
      resolvedPath.startsWith(assetsRoot + path.sep) ||
      resolvedPath === assetsRoot
    );
  }

  const dataRoot = "/Users/test/.tower/storage";

  describe("allows paths within storage/assets/", () => {
    it("accepts file directly in assets dir", () => {
      expect(isRevealAllowed("assets/proj1/image.png", dataRoot)).toBe(true);
    });

    it("accepts nested asset path", () => {
      expect(
        isRevealAllowed("assets/proj1/2026-04/images/photo.jpg", dataRoot)
      ).toBe(true);
    });

    it("accepts assets root itself", () => {
      expect(isRevealAllowed("assets/", dataRoot)).toBe(true);
    });
  });

  describe("BLOCKS paths outside storage/assets/", () => {
    it("blocks path traversal to parent", () => {
      expect(isRevealAllowed("assets/../../etc/passwd", dataRoot)).toBe(false);
    });

    it("blocks absolute path outside assets", () => {
      expect(isRevealAllowed("/etc/passwd", dataRoot)).toBe(false);
    });

    it("blocks path to storage root", () => {
      expect(isRevealAllowed(".", dataRoot)).toBe(false);
    });

    it("blocks path to cache (not assets)", () => {
      expect(isRevealAllowed("cache/secrets.json", dataRoot)).toBe(false);
    });

    it("blocks prefix-matching attack (assets-evil/)", () => {
      expect(isRevealAllowed("assets-evil/file.txt", dataRoot)).toBe(false);
    });

    it("blocks path to home directory", () => {
      expect(isRevealAllowed("/Users/test/.ssh/id_rsa", dataRoot)).toBe(false);
    });
  });
});
