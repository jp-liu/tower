"use server";

import { readdir, readFile, writeFile, mkdir, rename, rm, unlink, stat, open } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import ignore from "ignore";
import { execFileSync } from "child_process";
import { safeResolvePath } from "@/lib/fs-security";
import { getConfigValue } from "@/actions/config-actions";
import { z } from "zod";

export interface FileEntry {
  name: string;
  relativePath: string; // relative to worktreePath
  isDirectory: boolean;
  gitStatus?: "M" | "A" | "D";
}

// ---- listDirectory ----
const listDirectorySchema = z.object({
  worktreePath: z.string().min(1),
  relativePath: z.string().default("."),
});

export async function listDirectory(
  worktreePath: string,
  relativePath: string = "."
): Promise<FileEntry[]> {
  listDirectorySchema.parse({ worktreePath, relativePath });
  const absoluteDir = safeResolvePath(worktreePath, relativePath);

  const ig = ignore();
  ig.add(".git"); // always filter .git regardless of .gitignore
  const gitignorePath = path.join(worktreePath, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, "utf-8");
    ig.add(content);
  }

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const filtered = entries.filter((e) => {
    // CRITICAL: must use path relative to worktree root, not absolute
    const rel = path.relative(worktreePath, path.join(absoluteDir, e.name));
    return !ig.ignores(rel);
  });

  return filtered
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory())
        return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => ({
      name: e.name,
      relativePath: path.relative(worktreePath, path.join(absoluteDir, e.name)),
      isDirectory: e.isDirectory(),
    }));
}

// ---- getGitStatus ----
// In direct mode (no baseBranch/taskBranch), falls back to `git status --porcelain`.
// If cwd is not a git repo, execFileSync throws and the catch returns {} — this is expected.
export async function getGitStatus(
  worktreePath: string,
  baseBranch: string | null,
  taskBranch: string | null
): Promise<Record<string, "M" | "A" | "D">> {
  try {
    let output: string;
    if (baseBranch && taskBranch) {
      // Worktree mode: diff between branches
      output = execFileSync(
        "git",
        ["diff", "--name-status", `${baseBranch}...${taskBranch}`],
        { cwd: worktreePath, encoding: "utf-8", timeout: 10000 }
      );
    } else {
      // Direct mode: working tree status via git status
      output = execFileSync(
        "git",
        ["status", "--porcelain", "-uall"],
        { cwd: worktreePath, encoding: "utf-8", timeout: 10000 }
      );
    }
    const result: Record<string, "M" | "A" | "D"> = {};
    if (baseBranch && taskBranch) {
      for (const line of output.split("\n").filter(Boolean)) {
        const parts = line.split("\t");
        const status = parts[0];
        const filePath = parts[1];
        if ((status === "M" || status === "A" || status === "D") && filePath) {
          result[filePath] = status as "M" | "A" | "D";
        }
      }
    } else {
      // Parse porcelain format: "XY filename"
      for (const line of output.split("\n").filter(Boolean)) {
        const xy = line.substring(0, 2);
        const filePath = line.substring(3);
        if (!filePath) continue;
        if (xy.includes("D")) {
          result[filePath] = "D";
        } else if (xy === "??" || xy.includes("A")) {
          result[filePath] = "A";
        } else {
          result[filePath] = "M";
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ---- createFile ----
export async function createFile(
  worktreePath: string,
  relativePath: string
): Promise<void> {
  z.object({ worktreePath: z.string().min(1), relativePath: z.string().min(1) })
    .parse({ worktreePath, relativePath });
  const absolute = safeResolvePath(worktreePath, relativePath);
  await writeFile(absolute, "", { flag: "wx" }); // wx = fail if exists
}

// ---- createDirectory ----
export async function createDirectory(
  worktreePath: string,
  relativePath: string
): Promise<void> {
  z.object({ worktreePath: z.string().min(1), relativePath: z.string().min(1) })
    .parse({ worktreePath, relativePath });
  const absolute = safeResolvePath(worktreePath, relativePath);
  await mkdir(absolute, { recursive: true });
}

// ---- renameEntry ----
export async function renameEntry(
  worktreePath: string,
  oldRelativePath: string,
  newRelativePath: string
): Promise<void> {
  z.object({
    worktreePath: z.string().min(1),
    oldRelativePath: z.string().min(1),
    newRelativePath: z.string().min(1),
  }).parse({ worktreePath, oldRelativePath, newRelativePath });
  const oldAbsolute = safeResolvePath(worktreePath, oldRelativePath);
  const newAbsolute = safeResolvePath(worktreePath, newRelativePath);
  await rename(oldAbsolute, newAbsolute);
}

// ---- deleteEntry ----
export async function deleteEntry(
  worktreePath: string,
  relativePath: string
): Promise<void> {
  z.object({ worktreePath: z.string().min(1), relativePath: z.string().min(1) })
    .parse({ worktreePath, relativePath });
  // Guard: never delete .git/ — checked before path resolution (D-10)
  if (path.basename(relativePath) === ".git") {
    throw new Error("Cannot delete .git directory");
  }
  const absolute = safeResolvePath(worktreePath, relativePath);
  const info = await stat(absolute);
  if (info.isDirectory()) {
    await rm(absolute, { recursive: true, force: true });
  } else {
    await unlink(absolute);
  }
}

// ---- listAllFiles ----
const listAllFilesSchema = z.object({
  worktreePath: z.string().min(1),
});

export async function listAllFiles(
  worktreePath: string
): Promise<string[]> {
  listAllFilesSchema.parse({ worktreePath });

  const ig = ignore();
  ig.add(".git");
  const gitignorePath = path.join(worktreePath, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, "utf-8");
    ig.add(content);
  }

  const results: string[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(worktreePath, abs);
      if (ig.ignores(rel)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        results.push(rel);
      }
    }
  }

  await walk(worktreePath);
  return results;
}

// ---- readFileContent ----
const readFileContentSchema = z.object({
  worktreePath: z.string().min(1),
  relativePath: z.string().min(1),
});

/**
 * Discriminated result of a guarded file read.
 * - `text`: file passed size + binary checks; full UTF-8 content returned
 * - `oversized`: file size exceeds the configured `system.maxReadableFileBytes` limit; body NOT read
 * - `binary`: a NUL byte was found in the first 8KB; body NOT read
 */
export type FileReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "oversized"; size: number; limit: number }
  | { kind: "binary"; size: number };

export async function readFileContent(
  worktreePath: string,
  relativePath: string
): Promise<FileReadResult> {
  readFileContentSchema.parse({ worktreePath, relativePath });
  const absolute = safeResolvePath(worktreePath, relativePath);

  const limit = await getConfigValue<number>("system.maxReadableFileBytes", 5_242_880);
  const info = await stat(absolute);

  // Fast path: oversized files short-circuit before any read
  if (info.size > limit) {
    return { kind: "oversized", size: info.size, limit };
  }

  // Sniff first 8KB for null bytes to detect binary
  const fh = await open(absolute, "r");
  try {
    const sniffSize = Math.min(8192, info.size);
    if (sniffSize > 0) {
      const sniff = Buffer.alloc(sniffSize);
      await fh.read(sniff, 0, sniffSize, 0);
      if (sniff.includes(0)) {
        return { kind: "binary", size: info.size };
      }
    }
  } finally {
    await fh.close();
  }

  const content = await readFile(absolute, "utf-8");
  return { kind: "text", content, size: info.size };
}

// ---- readFileContentForce ----
/**
 * Force-open variant: bypasses both size and binary guards. Caller accepts
 * possible UTF-8 garbling and browser slowdown. Path traversal protection still applies.
 */
export async function readFileContentForce(
  worktreePath: string,
  relativePath: string
): Promise<{ content: string; size: number }> {
  readFileContentSchema.parse({ worktreePath, relativePath });
  const absolute = safeResolvePath(worktreePath, relativePath);
  const info = await stat(absolute);
  const content = await readFile(absolute, "utf-8");
  return { content, size: info.size };
}

// ---- writeFileContent ----
const writeFileContentSchema = z.object({
  worktreePath: z.string().min(1),
  relativePath: z.string().min(1),
  content: z.string(),
});

export async function writeFileContent(
  worktreePath: string,
  relativePath: string,
  content: string
): Promise<void> {
  writeFileContentSchema.parse({ worktreePath, relativePath, content });
  const absolute = safeResolvePath(worktreePath, relativePath);
  await writeFile(absolute, content, "utf-8");
}

/**
 * Reveal a file or folder in the system file manager.
 */
export async function revealInFinder(worktreePath: string, relativePath: string): Promise<void> {
  const absolute = safeResolvePath(worktreePath, relativePath);
  const { execFile } = await import("child_process");
  const platform = process.platform;

  await new Promise<void>((resolve, reject) => {
    if (platform === "darwin") {
      execFile("open", ["-R", absolute], (err) => err ? reject(err) : resolve());
    } else if (platform === "linux") {
      execFile("xdg-open", [path.dirname(absolute)], (err) => err ? reject(err) : resolve());
    } else if (platform === "win32") {
      execFile("explorer", ["/select,", absolute], (err) => err ? reject(err) : resolve());
    } else {
      reject(new Error("Unsupported platform"));
    }
  });
}
