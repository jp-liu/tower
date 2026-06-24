// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import os from "os";
import path from "path";

import { isTowerLinkedDir, stripTowerLinkedStatus, WORKTREE_LINKED_DIRS } from "@/lib/worktree";

// Simulates a Tower worktree: subpackage node_modules / .next are symlinks
// injected by Tower (see symlinkNodeModules), while real new files are not.
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "wt-status-"));
  // Real dependency store the symlinks point at
  mkdirSync(path.join(root, "store"));
  // Root-level node_modules symlink
  symlinkSync(path.join(root, "store"), path.join(root, "node_modules"), "junction");
  // Nested monorepo package: apps/web/node_modules symlink + .next symlink
  mkdirSync(path.join(root, "apps", "web"), { recursive: true });
  symlinkSync(path.join(root, "store"), path.join(root, "apps", "web", "node_modules"), "junction");
  symlinkSync(path.join(root, "store"), path.join(root, "apps", "web", ".next"), "junction");
  // A real, genuinely-untracked source file the user wrote
  writeFileSync(path.join(root, "apps", "web", "new-file.ts"), "export const x = 1;\n");
  // A real (non-symlink) directory that happens to be named node_modules
  mkdirSync(path.join(root, "packages", "real", "node_modules"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("isTowerLinkedDir", () => {
  it("matches a root-level node_modules symlink", () => {
    expect(isTowerLinkedDir("node_modules", root)).toBe(true);
  });

  it("matches a nested node_modules symlink", () => {
    expect(isTowerLinkedDir("apps/web/node_modules", root)).toBe(true);
  });

  it("matches a nested .next symlink", () => {
    expect(isTowerLinkedDir("apps/web/.next", root)).toBe(true);
  });

  it("tolerates a trailing slash on the path", () => {
    expect(isTowerLinkedDir("apps/web/node_modules/", root)).toBe(true);
  });

  it("does NOT match a real untracked source file", () => {
    expect(isTowerLinkedDir("apps/web/new-file.ts", root)).toBe(false);
  });

  it("does NOT match a real (non-symlink) directory named node_modules", () => {
    expect(isTowerLinkedDir("packages/real/node_modules", root)).toBe(false);
  });

  it("does NOT match a path whose basename is not a linked dir", () => {
    expect(isTowerLinkedDir("apps/web/dist", root)).toBe(false);
  });

  it("exposes the linked dir names it filters", () => {
    expect(WORKTREE_LINKED_DIRS).toContain("node_modules");
    expect(WORKTREE_LINKED_DIRS).toContain(".next");
  });
});

describe("stripTowerLinkedStatus", () => {
  it("drops untracked Tower symlinks but keeps real changes", () => {
    const porcelain = [
      "?? node_modules",
      "?? apps/web/node_modules",
      "?? apps/web/.next",
      "?? apps/web/new-file.ts",
      " M apps/web/components.d.ts",
    ];
    expect(stripTowerLinkedStatus(porcelain, root)).toEqual([
      "?? apps/web/new-file.ts",
      " M apps/web/components.d.ts",
    ]);
  });

  it("never drops tracked (non-??) changes even if named node_modules", () => {
    // A staged/modified entry must always survive, regardless of name.
    const porcelain = ["M  node_modules"];
    expect(stripTowerLinkedStatus(porcelain, root)).toEqual(["M  node_modules"]);
  });

  it("returns a clean (empty) list when only Tower symlinks are present", () => {
    const porcelain = ["?? node_modules", "?? apps/web/node_modules", "?? apps/web/.next"];
    expect(stripTowerLinkedStatus(porcelain, root)).toEqual([]);
  });
});
