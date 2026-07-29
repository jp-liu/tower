import { execFileSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import os from "os";
import { logger } from "@/lib/logger";

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Absolute path of a task's worktree dir under `<localPath>/.worktrees`. */
export function worktreePathFor(localPathRaw: string, taskId: string): string {
  return path.join(expandHome(localPathRaw), ".worktrees", "task-" + taskId);
}

export interface WorktreeResult {
  worktreePath: string;
  worktreeBranch: string;
}

/**
 * Creates a git worktree for the given task, or reuses one if it already exists.
 *
 * @param localPath  - Absolute path to the project root (git repo)
 * @param taskId     - The task ID (used to derive the worktree path)
 * @param baseBranch - The branch to base the new task branch on
 * @param branch     - Branch name to create/attach; defaults to `task/<taskId>`.
 *   Callers resolve label-based naming rules (see `resolveWorktreeBranch`) and
 *   pass the result, keeping this module free of db/config dependencies.
 * @returns WorktreeResult with the worktree path and branch name
 * @throws If git worktree add fails with a non-recoverable error
 */
export async function createWorktree(
  localPathRaw: string,
  taskId: string,
  baseBranch: string,
  branch?: string
): Promise<WorktreeResult> {
  const localPath = expandHome(localPathRaw);
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = branch ?? "task/" + taskId;

  // Validate that the local path exists and is a git repository before
  // running any git command — otherwise execFileSync throws a raw shell
  // error ("Command failed: git ...") that is opaque to the user.
  if (!existsSync(localPath)) {
    throw new Error(`项目本地路径不存在：${localPath}`);
  }
  try {
    execFileSync(
      "git", ["rev-parse", "--is-inside-work-tree"],
      { cwd: localPath, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch {
    throw new Error(`项目本地路径不是 Git 仓库，无法创建 worktree：${localPath}`);
  }

  // Ensure .worktrees directory exists
  await mkdir(path.join(localPath, ".worktrees"), { recursive: true });

  // Check if worktree already exists (reuse case)
  const worktreeList = execFileSync(
    "git", ["worktree", "list", "--porcelain"],
    { cwd: localPath, encoding: "utf-8", timeout: 10000 }
  );

  // Normalize paths for cross-platform comparison (Windows may have mixed slashes)
  const normalizedWorktreePath = path.normalize(worktreePath).replace(/\\/g, "/");
  const worktreeLines = worktreeList.split("\n");
  const alreadyExists = worktreeLines.some(
    (line: string) => line.startsWith("worktree ") &&
      line.slice(9).replace(/\\/g, "/") === normalizedWorktreePath
  );

  if (alreadyExists) {
    // Reuse path: still (re)ensure node_modules links. The worktree may have
    // been created before deps were installed, so the links could be missing.
    // Dependency preparation is idempotent and migrates legacy shared links.
    prepareWorktreeDependencies(localPath, worktreePath);
    return { worktreePath, worktreeBranch };
  }

  // Additional check: if directory exists but not in git worktree list, clean it up first
  if (existsSync(worktreePath)) {
    logger.warn(`[worktree] Directory exists but not tracked by git, removing: ${worktreePath}`);
    execFileSync(
      "git", ["worktree", "remove", worktreePath, "--force"],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  }

  // Check if the task branch already exists
  const branchList = execFileSync(
    "git", ["branch", "--list", worktreeBranch],
    { cwd: localPath, encoding: "utf-8", timeout: 5000 }
  ).trim();

  if (branchList) {
    // Branch exists: attach existing branch without -b flag (preserves previous work)
    execFileSync(
      "git", ["worktree", "add", worktreePath, worktreeBranch],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  } else {
    // Resolve baseBranch — try local first, then remote (origin/xxx)
    let resolvedBase = baseBranch;
    try {
      execFileSync("git", ["rev-parse", "--verify", baseBranch], { cwd: localPath, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      // Local branch doesn't exist — try as remote tracking branch
      try {
        execFileSync("git", ["rev-parse", "--verify", `origin/${baseBranch}`], { cwd: localPath, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
        resolvedBase = `origin/${baseBranch}`;
      } catch {
        throw new Error(
          `Base branch '${baseBranch}' does not exist locally or on remote. Available branches: ` +
          execFileSync("git", ["branch", "-a", "--format=%(refname:short)"], { cwd: localPath, encoding: "utf-8", timeout: 5000 }).trim().split("\n").join(", ")
        );
      }
    }

    // Branch does not exist: create new branch from resolved base
    execFileSync(
      "git", ["worktree", "add", "-b", worktreeBranch, worktreePath, resolvedBase],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  }

  // Prepare dependencies without allowing worktree installs to mutate the main checkout.
  prepareWorktreeDependencies(localPath, worktreePath);

  return { worktreePath, worktreeBranch };
}

/** Directories that are never descended into when scanning for package.json. */
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees"]);
/** Guards against pathological recursion; real monorepos nest only a few levels. */
const MAX_SCAN_DEPTH = 8;

/**
 * Recursively finds every directory under `root` that directly contains a
 * `package.json`, returned as paths relative to `root` ("" = the root itself).
 *
 * Skips `node_modules` (and other VCS/worktree dirs) entirely — it neither
 * descends into them nor reports package.json files found inside them — and
 * ignores dot-directories, which are never real workspace packages.
 */
function findPackageDirs(root: string): string[] {
  const results: string[] = [];

  const walk = (absDir: string, rel: string, depth: number): void => {
    if (existsSync(path.join(absDir, "package.json"))) {
      results.push(rel);
    }
    if (depth >= MAX_SCAN_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true }) as Dirent[];
    } catch {
      return; // unreadable dir — skip silently
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (SCAN_SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      walk(
        path.join(absDir, name),
        rel ? path.join(rel, name) : name,
        depth + 1
      );
    }
  };

  walk(root, "", 0);
  return results;
}

/**
 * Makes installed dependencies and Next.js caches available in a worktree.
 * pnpm projects get an isolated offline install backed by pnpm's shared content
 * store; other package managers retain the legacy dependency-directory links.
 *
 * Scans the whole source repo for every directory containing a `package.json`
 * — front-end, back-end, and nested monorepo packages alike. This makes no
 * assumption about project type (front/back); a package.json is enough.
 *
 * Idempotent and best-effort: a missing source dir is skipped (and logged for
 * node_modules), an already-present target is left untouched, and any single
 * symlink failure is logged without aborting the rest.
 */
/**
 * Dependency/cache directory names that Tower injects into a worktree. pnpm
 * node_modules directories are isolated real directories; other entries are
 * links. These are the only names the status filter treats as Tower noise.
 */
export const WORKTREE_LINKED_DIRS = ["node_modules", ".next"] as const;
export const WORKTREE_DEPENDENCY_MARKER = ".tower-worktree-deps";

function symlinkPointsTo(target: string, source: string): boolean {
  try {
    const linkedPath = readlinkSync(target);
    return path.resolve(path.dirname(target), linkedPath) === path.resolve(source);
  } catch {
    return false;
  }
}

function ensureIsolatedPnpmModules(
  projectRoot: string,
  worktreePath: string,
  packageDirs: string[]
): void {
  const log = logger.create("worktree");
  const rootTarget = path.join(worktreePath, "node_modules");
  let needsInstall = !existsSync(rootTarget);

  for (const pkgDir of packageDirs) {
    const rel = pkgDir ? path.join(pkgDir, "node_modules") : "node_modules";
    const source = path.join(projectRoot, rel);
    const target = path.join(worktreePath, rel);
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() && symlinkPointsTo(target, source)) {
        unlinkSync(target);
        needsInstall = true;
      }
    } catch {
      // A missing package-local directory is created by the workspace install.
    }
  }

  if (needsInstall) {
    try {
      execFileSync(
        "pnpm install --offline --frozen-lockfile --ignore-scripts",
        {
          cwd: worktreePath,
          encoding: "utf-8",
          timeout: 120000,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, CI: "true" },
          shell: true,
        }
      );
      log.info("Installed isolated pnpm dependencies from the local store", { worktreePath });
    } catch (err) {
      log.warn("Failed to install isolated pnpm dependencies", {
        worktreePath,
        error: String(err),
      });
      return;
    }
  }

  for (const pkgDir of packageDirs) {
    const target = path.join(worktreePath, pkgDir, "node_modules");
    if (!existsSync(target)) continue;
    try {
      writeFileSync(path.join(target, WORKTREE_DEPENDENCY_MARKER), "");
    } catch (err) {
      log.warn(`Failed to mark isolated dependencies at ${target}`, { error: String(err) });
    }
  }
}

function prepareWorktreeDependencies(projectRoot: string, worktreePath: string): void {
  const log = logger.create("worktree");
  // Dependency/cache directories that should be shared into the worktree.
  const dirs = WORKTREE_LINKED_DIRS;
  const packageDirs = findPackageDirs(projectRoot);
  const isolatePnpmModules =
    existsSync(path.join(projectRoot, "pnpm-lock.yaml")) &&
    existsSync(path.join(projectRoot, "node_modules", ".pnpm"));

  if (isolatePnpmModules) {
    ensureIsolatedPnpmModules(projectRoot, worktreePath, packageDirs);
  }

  for (const pkgDir of packageDirs) {
    for (const dir of dirs) {
      if (isolatePnpmModules && dir === "node_modules") continue;
      const rel = pkgDir ? path.join(pkgDir, dir) : dir;
      const source = path.join(projectRoot, rel);
      const target = path.join(worktreePath, rel);

      if (!existsSync(source)) {
        if (dir === "node_modules") {
          log.info(`Skipped ${rel} — source not installed`, { source });
        }
        continue;
      }

      // Skip if target already exists (real dir or existing symlink).
      try {
        lstatSync(target);
        continue;
      } catch {
        // Does not exist — proceed to create symlink
      }

      try {
        // The package dir is git-tracked so the worktree usually has it, but
        // ensure the parent exists before linking to stay robust.
        mkdirSync(path.dirname(target), { recursive: true });
        symlinkSync(source, target, "junction"); // "junction" works on Windows too
        log.info(`Symlinked ${rel}`, { from: source, to: target });
      } catch (err) {
        log.warn(`Failed to link ${rel}`, { error: String(err) });
      }
    }
  }
}

/**
 * Removes a git worktree and its associated task branch.
 *
 * Best-effort: skips steps that are already done (missing dir or branch).
 * Callers should wrap in try/catch — this function may throw on git errors.
 *
 * @param localPath - Absolute path to the project root (git repo)
 * @param taskId    - The task ID (used to derive the worktree path)
 * @param branch    - Branch to delete; defaults to `task/<taskId>`. Pass the
 *   name recorded at creation time (`getRecordedWorktreeBranch`) — a task whose
 *   naming rule matched a label has a custom prefix that cannot be re-derived.
 */
export async function removeWorktree(
  localPathRaw: string,
  taskId: string,
  branch?: string
): Promise<void> {
  const localPath = expandHome(localPathRaw);
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = branch ?? "task/" + taskId;

  // D-11: Only remove worktree dir if it exists
  if (existsSync(worktreePath)) {
    execFileSync(
      "git", ["worktree", "remove", worktreePath, "--force"],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  }

  // D-12: Only delete branch if it exists
  const branchExists = execFileSync(
    "git", ["branch", "--list", worktreeBranch],
    { cwd: localPath, encoding: "utf-8", timeout: 5000 }
  ).trim();

  if (branchExists) {
    execFileSync(
      "git", ["branch", "-D", worktreeBranch],
      { cwd: localPath, encoding: "utf-8", timeout: 5000 }
    );
  }
}

/**
 * True if a repo-relative path (as emitted by `git status`) points at a
 * Tower-injected dependency/cache entry (`node_modules` / `.next`) inside the
 * worktree.
 *
 * Why this exists: Tower injects these dirs into worktrees (see
 * `prepareWorktreeDependencies`). A `.gitignore` rule written with a trailing slash
 * (`node_modules/`) matches *directories only* — but git treats a symlink as a
 * file, so the rule never matches the link and git reports it as untracked.
 * Those entries are not user changes and must not count toward "worktree dirty".
 * Tower's own repo escapes this because its `.gitignore` uses `/node_modules`
 * (no slash), which does match the symlink.
 *
 * The on-disk symlink check keeps this conservative: a real (non-symlink)
 * directory or file that merely shares the name is left untouched.
 */
export function isTowerLinkedDir(relPath: string, worktreeRoot: string): boolean {
  const cleaned = relPath.replace(/[/\\]+$/, "");
  const base = path.basename(cleaned);
  if (!(WORKTREE_LINKED_DIRS as readonly string[]).includes(base)) return false;
  try {
    const absolutePath = path.join(worktreeRoot, cleaned);
    const stat = lstatSync(absolutePath);
    return stat.isSymbolicLink() || (
      base === "node_modules" &&
      stat.isDirectory() &&
      existsSync(path.join(absolutePath, WORKTREE_DEPENDENCY_MARKER))
    );
  } catch {
    return false;
  }
}

/**
 * Drops untracked (`??`) `git status --porcelain` entries that are
 * Tower-injected dependency symlinks. Tracked changes (staged/modified/etc.)
 * are always preserved, as are genuinely untracked files the user created.
 */
export function stripTowerLinkedStatus(porcelainLines: string[], worktreeRoot: string): string[] {
  return porcelainLines.filter((line) => {
    if (!line.startsWith("??")) return true; // keep all tracked changes
    const relPath = line.slice(2).trim(); // "?? path" → "path"
    return !isTowerLinkedDir(relPath, worktreeRoot);
  });
}
