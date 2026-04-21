/**
 * Security tests for /api/internal/assets/reveal
 *
 * Tests that the reveal API only allows paths within data/assets/.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";

describe("Reveal Route Path Containment", () => {
  // Extracted path containment logic from the route for unit testing
  function isRevealAllowed(bodyPath: string, cwd: string): boolean {
    const resolvedPath = path.resolve(cwd, bodyPath);
    const assetsRoot = path.resolve(cwd, "data/assets/");
    return (
      resolvedPath.startsWith(assetsRoot + path.sep) ||
      resolvedPath === assetsRoot
    );
  }

  const cwd = "/Users/test/project/tower";

  describe("allows paths within data/assets/", () => {
    it("accepts file directly in assets dir", () => {
      expect(isRevealAllowed("data/assets/proj1/image.png", cwd)).toBe(true);
    });

    it("accepts nested asset path", () => {
      expect(
        isRevealAllowed("data/assets/proj1/2026-04/images/photo.jpg", cwd)
      ).toBe(true);
    });

    it("accepts assets root itself", () => {
      expect(isRevealAllowed("data/assets/", cwd)).toBe(true);
    });
  });

  describe("BLOCKS paths outside data/assets/", () => {
    it("blocks path traversal to parent", () => {
      expect(isRevealAllowed("data/assets/../../etc/passwd", cwd)).toBe(false);
    });

    it("blocks absolute path outside assets", () => {
      expect(isRevealAllowed("/etc/passwd", cwd)).toBe(false);
    });

    it("blocks path to project root", () => {
      expect(isRevealAllowed(".", cwd)).toBe(false);
    });

    it("blocks path to data/ (not data/assets/)", () => {
      expect(isRevealAllowed("data/cache/secrets.json", cwd)).toBe(false);
    });

    it("blocks prefix-matching attack (data/assets-evil/)", () => {
      expect(isRevealAllowed("data/assets-evil/file.txt", cwd)).toBe(false);
    });

    it("blocks path to home directory", () => {
      expect(isRevealAllowed("/Users/test/.ssh/id_rsa", cwd)).toBe(false);
    });
  });
});
