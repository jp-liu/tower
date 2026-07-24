import "server-only";

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export const PROJECT_ANALYSIS_MAX_FILES = 30;
export const PROJECT_ANALYSIS_MAX_FILE_BYTES = 16 * 1024;
export const PROJECT_ANALYSIS_MAX_TOTAL_BYTES = 64 * 1024;
export const PROJECT_ANALYSIS_MAX_OVERVIEW_ENTRIES = 200;

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", ".worktrees", ".ssh", ".aws", ".config",
  "node_modules", ".next", "dist", "build", "coverage", "vendor",
]);

const ALLOWED_ROOT_FILES = new Set([
  "package.json",
  "cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "pom.xml",
  "composer.json",
  "gemfile",
  "mix.exs",
  "tsconfig.json",
  "deno.json",
  "deno.jsonc",
  "pubspec.yaml",
  "project.clj",
]);

const ALLOWED_CONFIG = /^(?:next|vite|webpack|rollup|svelte|astro|nuxt|angular|eslint|prettier|tailwind|vitest|jest)\.config\.(?:js|cjs|mjs|ts|json)$/i;
const ALLOWED_BUILD = /^(?:build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|makefile|cmakelists\.txt)$/i;
const README = /^readme(?:\.[a-z0-9_-]+)?$/i;
const SENSITIVE_NAME = /(^|[._-])(?:env|credentials?|secrets?|tokens?|private[_-]?key|id_(?:rsa|dsa|ed25519)|service[_-]?account|netrc|npmrc|pypirc)(?:[._-]|$)|\.(?:pem|key|p12|pfx)$/i;

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAllowedRootFile(name: string): boolean {
  const lower = name.toLowerCase();
  return !SENSITIVE_NAME.test(name)
    && (ALLOWED_ROOT_FILES.has(lower) || README.test(name) || ALLOWED_CONFIG.test(name) || ALLOWED_BUILD.test(name));
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
}

async function shallowOverview(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 2 || result.length >= PROJECT_ANALYSIS_MAX_OVERVIEW_ENTRIES) return;
    let entries: Dirent[];
    try {
      entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => compareNames(a.name, b.name));
    } catch (error) {
      if (directory === root) throw error;
      return;
    }
    for (const entry of entries) {
      if (result.length >= PROJECT_ANALYSIS_MAX_OVERVIEW_ENTRIES) return;
      if (entry.isSymbolicLink() || SENSITIVE_NAME.test(entry.name)) continue;
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      result.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory()) await visit(absolute, depth + 1);
    }
  }
  await visit(root, 1);
  return result;
}

export async function buildProjectAnalysisContext(localPath: string): Promise<string> {
  const root = await realpath(localPath);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error("invalid_project_directory");

  const rootEntries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && isAllowedRootFile(entry.name))
    .sort((a, b) => compareNames(a.name, b.name))
    .slice(0, PROJECT_ANALYSIS_MAX_FILES);
  const overview = await shallowOverview(root);
  const sections: string[] = ["Directory overview:\n" + overview.join("\n")];

  for (const entry of rootEntries) {
    try {
      const absolute = path.join(root, entry.name);
      const resolved = await realpath(absolute);
      if (!isWithinRoot(root, resolved)) continue;
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const bytes = await readFile(absolute);
      const text = truncateUtf8(bytes.toString("utf8"), PROJECT_ANALYSIS_MAX_FILE_BYTES);
      sections.push(`File: ${entry.name}\n\`\`\`\n${text}\n\`\`\``);
    } catch {
      // Files may disappear or become unreadable while the snapshot is built.
    }
  }

  return truncateUtf8(sections.join("\n\n"), PROJECT_ANALYSIS_MAX_TOTAL_BYTES);
}
