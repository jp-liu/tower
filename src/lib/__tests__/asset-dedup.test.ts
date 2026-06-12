// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  deriveSourceKey,
  shortHash,
  hashFile,
  buildAssetFilename,
} from "@/lib/asset-dedup";

describe("deriveSourceKey", () => {
  const projectRoot = "/Users/test/project/my-app";

  it("keys a file at the project root by its basename-relative path", () => {
    expect(deriveSourceKey(`${projectRoot}/00-index.md`, projectRoot)).toBe(
      "00-index.md"
    );
  });

  it("keys a nested project file by its project-relative path", () => {
    expect(
      deriveSourceKey(`${projectRoot}/docs/00-index.md`, projectRoot)
    ).toBe("docs/00-index.md");
  });

  it("strips the .worktrees/<wt>/ prefix so worktree runs map to the same key", () => {
    const inWorktree = `${projectRoot}/.worktrees/task-cabc123/docs/00-index.md`;
    const inProject = `${projectRoot}/docs/00-index.md`;
    expect(deriveSourceKey(inWorktree, projectRoot)).toBe("docs/00-index.md");
    expect(deriveSourceKey(inWorktree, projectRoot)).toBe(
      deriveSourceKey(inProject, projectRoot)
    );
  });

  it("collapses repeated edits of the same worktree file to one key", () => {
    const f = `${projectRoot}/.worktrees/task-cabc123/真机校准报告.md`;
    expect(deriveSourceKey(f, projectRoot)).toBe("真机校准报告.md");
  });

  it("keeps distinct keys for same-basename files in different dirs", () => {
    expect(deriveSourceKey(`${projectRoot}/a/index.md`, projectRoot)).not.toBe(
      deriveSourceKey(`${projectRoot}/b/index.md`, projectRoot)
    );
  });

  it("falls back to basename for files outside the project (tmp)", () => {
    expect(deriveSourceKey("/tmp/scratch/report.md", projectRoot)).toBe(
      "report.md"
    );
  });

  it("falls back to basename when projectRoot is null", () => {
    expect(deriveSourceKey("/anywhere/report.md", null)).toBe("report.md");
  });

  it("is stable across calls (deterministic)", () => {
    const f = `${projectRoot}/docs/x.md`;
    expect(deriveSourceKey(f, projectRoot)).toBe(deriveSourceKey(f, projectRoot));
  });
});

describe("shortHash", () => {
  it("is deterministic for the same input", () => {
    expect(shortHash("docs/index.md")).toBe(shortHash("docs/index.md"));
  });

  it("differs for different inputs", () => {
    expect(shortHash("a/index.md")).not.toBe(shortHash("b/index.md"));
  });

  it("honors the requested length", () => {
    expect(shortHash("x", 8)).toHaveLength(8);
    expect(shortHash("x", 12)).toHaveLength(12);
  });
});

describe("hashFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-dedup-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns the same hash for identical content", () => {
    const a = path.join(dir, "a.md");
    const b = path.join(dir, "b.md");
    fs.writeFileSync(a, "hello world");
    fs.writeFileSync(b, "hello world");
    expect(hashFile(a)).toBe(hashFile(b));
  });

  it("returns a different hash when content changes", () => {
    const f = path.join(dir, "a.md");
    fs.writeFileSync(f, "v1");
    const h1 = hashFile(f);
    fs.writeFileSync(f, "v2");
    expect(hashFile(f)).not.toBe(h1);
  });
});

describe("buildAssetFilename", () => {
  it("uses the bare basename when no disambiguation is needed", () => {
    expect(buildAssetFilename("docs/00-index.md", "md", false)).toBe(
      "00-index.md"
    );
  });

  it("appends a deterministic sourceKey hash on real collisions (not a timestamp)", () => {
    const name = buildAssetFilename("b/index.md", "md", true);
    expect(name).toBe(`index-${shortHash("b/index.md")}.md`);
    // Same logical file always resolves to the same disambiguated name.
    expect(buildAssetFilename("b/index.md", "md", true)).toBe(name);
    // No millisecond timestamp leaks into the name.
    expect(name).not.toMatch(/-\d{13}\./);
  });

  it("handles extensionless names", () => {
    expect(buildAssetFilename("LICENSE", "", true)).toBe(
      `LICENSE-${shortHash("LICENSE")}`
    );
  });
});
