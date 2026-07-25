// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import {
  buildProjectAnalysisContext,
  PROJECT_ANALYSIS_MAX_FILE_BYTES,
  PROJECT_ANALYSIS_MAX_TOTAL_BYTES,
  readBoundedUtf8File,
  type BoundedOpenFile,
} from "../project-analysis-context";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tower-analysis-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("project analysis context", () => {
  it("uses a deterministic allowlist and excludes secret and VCS paths", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "src", "feature"), { recursive: true });
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, "package.json"), '{"name":"demo"}');
    await writeFile(path.join(root, "README.md"), "README CONTENT");
    await writeFile(path.join(root, ".env"), "ENV_CANARY_SECRET");
    await writeFile(path.join(root, "credentials.json"), "CREDENTIAL_CANARY_SECRET");
    await writeFile(path.join(root, "src", "feature", "index.ts"), "source");
    await writeFile(path.join(root, ".git", "config"), "GIT_CANARY_SECRET");

    const first = await buildProjectAnalysisContext(root);
    const second = await buildProjectAnalysisContext(root);
    expect(first).toBe(second);
    expect(first).toContain("File: README.md");
    expect(first).toContain("File: package.json");
    expect(first.indexOf("File: README.md")).toBeLessThan(first.indexOf("File: package.json"));
    expect(first).toContain("src/feature/");
    expect(first).not.toContain("ENV_CANARY_SECRET");
    expect(first).not.toContain("CREDENTIAL_CANARY_SECRET");
    expect(first).not.toContain("GIT_CANARY_SECRET");
  });

  it("never follows an allowlisted symlink outside the project root", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(path.join(outside, "outside.md"), "SYMLINK_CANARY_SECRET");
    await symlink(path.join(outside, "outside.md"), path.join(root, "README.md"));
    const context = await buildProjectAnalysisContext(root);
    expect(context).not.toContain("SYMLINK_CANARY_SECRET");
    expect(context).not.toContain("README.md");
  });

  it("enforces per-file and aggregate byte ceilings", async () => {
    const root = await tempDir();
    await writeFile(path.join(root, "README.md"), "a".repeat(PROJECT_ANALYSIS_MAX_FILE_BYTES + 4096) + "TAIL_CANARY");
    const context = await buildProjectAnalysisContext(root);
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(PROJECT_ANALYSIS_MAX_TOTAL_BYTES);
    expect(context).not.toContain("TAIL_CANARY");
  });

  it("allocates and reads no more than the explicit byte budget for a huge file", async () => {
    const read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
      buffer.fill(0x61, offset, offset + length);
      return { bytesRead: length };
    });
    const close = vi.fn(async () => {});
    const openFile = vi.fn(async () => ({
      stat: async () => ({ isFile: () => true, size: Number.MAX_SAFE_INTEGER }),
      read,
      close,
    })) as BoundedOpenFile;

    const result = await readBoundedUtf8File("/virtual/README.md", 4096, openFile);

    expect(result).toHaveLength(4096);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toHaveLength(4096);
    expect(read.mock.calls[0]?.slice(1)).toEqual([0, 4096, 0]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reads a sparse allowlisted file through the bounded path", async () => {
    const root = await tempDir();
    const filePath = path.join(root, "README.md");
    const handle = await open(filePath, "w");
    await handle.write("SPARSE_PREFIX");
    await handle.truncate(1024 * 1024 * 1024);
    await handle.close();

    const context = await buildProjectAnalysisContext(root);

    expect(context).toContain("SPARSE_PREFIX");
    expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(PROJECT_ANALYSIS_MAX_TOTAL_BYTES);
    expect(context.length).toBeLessThan(PROJECT_ANALYSIS_MAX_FILE_BYTES + 1024);
  });
});
