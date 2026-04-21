/**
 * Security tests for /api/internal/hooks/upload
 *
 * Tests the CRITICAL path containment fix: filePath must be within
 * the project directory or /tmp. Prevents arbitrary file read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";

// We test the path containment logic in isolation rather than the full route,
// because the route requires Next.js request objects and DB connections.

describe("Upload Route Path Containment", () => {
  // Extracted path containment logic for unit testing
  function isPathAllowed(
    filePath: string,
    projectRoot: string | null,
    tmpDir: string
  ): boolean {
    const resolvedFile = path.resolve(filePath);
    const isUnderProject =
      projectRoot &&
      resolvedFile.startsWith(path.resolve(projectRoot) + path.sep);
    const isUnderTmp = resolvedFile.startsWith(
      path.resolve(tmpDir) + path.sep
    );
    return !!(isUnderProject || isUnderTmp);
  }

  const projectRoot = "/Users/test/project/my-app";
  const tmpDir = "/tmp";

  describe("allows files within project directory", () => {
    it("accepts file directly in project root", () => {
      expect(
        isPathAllowed(`${projectRoot}/output.png`, projectRoot, tmpDir)
      ).toBe(true);
    });

    it("accepts file in nested subdirectory", () => {
      expect(
        isPathAllowed(`${projectRoot}/src/lib/output.json`, projectRoot, tmpDir)
      ).toBe(true);
    });
  });

  describe("allows files within /tmp", () => {
    it("accepts file in /tmp", () => {
      expect(isPathAllowed("/tmp/upload-123.png", projectRoot, tmpDir)).toBe(
        true
      );
    });

    it("accepts file in /tmp subdirectory", () => {
      expect(
        isPathAllowed("/tmp/tower/session/file.md", projectRoot, tmpDir)
      ).toBe(true);
    });
  });

  describe("BLOCKS files outside allowed directories", () => {
    it("blocks absolute path to home directory", () => {
      expect(
        isPathAllowed("/Users/test/.ssh/id_rsa", projectRoot, tmpDir)
      ).toBe(false);
    });

    it("blocks absolute path to claude settings", () => {
      expect(
        isPathAllowed(
          "/Users/test/.claude/settings.json",
          projectRoot,
          tmpDir
        )
      ).toBe(false);
    });

    it("blocks path traversal attack with ../", () => {
      expect(
        isPathAllowed(
          `${projectRoot}/../../../etc/passwd`,
          projectRoot,
          tmpDir
        )
      ).toBe(false);
    });

    it("blocks path to /etc", () => {
      expect(isPathAllowed("/etc/hosts", projectRoot, tmpDir)).toBe(false);
    });

    it("blocks root path", () => {
      expect(isPathAllowed("/", projectRoot, tmpDir)).toBe(false);
    });

    it("blocks path that starts with projectRoot as prefix but different dir", () => {
      // /Users/test/project/my-app-evil should NOT match /Users/test/project/my-app
      expect(
        isPathAllowed(
          "/Users/test/project/my-app-evil/secret.json",
          projectRoot,
          tmpDir
        )
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("blocks when projectRoot is null", () => {
      expect(isPathAllowed("/some/file.png", null, tmpDir)).toBe(false);
    });

    it("blocks symlink-like paths outside root (resolved)", () => {
      // path.resolve normalizes .. segments
      expect(
        isPathAllowed(`${projectRoot}/../../etc/shadow`, projectRoot, tmpDir)
      ).toBe(false);
    });
  });
});
