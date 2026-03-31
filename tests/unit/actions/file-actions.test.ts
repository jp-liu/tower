// @vitest-environment node
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as childProcess from "child_process";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("fs/promises");
vi.mock("fs");
vi.mock("child_process");
vi.mock("@/lib/fs-security", () => ({
  safeResolvePath: vi.fn((base: string, rel: string) => {
    const path = require("path");
    const resolved = path.resolve(base, rel);
    if (!resolved.startsWith(base)) throw new Error("Path traversal attempt");
    return resolved;
  }),
}));

// Stub: will be filled by Plan 02 implementation
describe("listDirectory", () => {
  it.todo("returns sorted entries with isDirectory flag");
  it.todo("filters gitignored entries");
  it.todo("always filters .git/ directory");
  it.todo("returns directories before files, then alphabetical");
});

describe("createFile", () => {
  it.todo("creates file at validated path");
  it.todo("throws on path traversal");
});

describe("createDirectory", () => {
  it.todo("creates directory recursively");
});

describe("renameEntry", () => {
  it.todo("renames entry at validated path");
});

describe("deleteEntry", () => {
  it.todo("deletes file for valid path");
  it.todo("refuses to delete .git/ directory");
  it.todo("recursively deletes directories with rm({ recursive: true })");
});

describe("getGitStatus", () => {
  it.todo("parses M, A, D lines from git diff output");
  it.todo("returns empty map on git error");
  it.todo("ignores unrecognized status letters");
});
