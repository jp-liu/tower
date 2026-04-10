"use server";

import { execSync, spawn } from "child_process";
import path from "path";
import os from "os";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Get the currently checked-out branch name */
function readCurrentBranch(resolved: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: resolved, encoding: "utf-8", timeout: 5000,
  }).trim();
}

/**
 * Read local + remote branches from the cached git refs.
 * No network call — returns instantly from the local .git directory.
 */
function readBranches(resolved: string): string[] {
  // Local branches
  const localRaw = execSync(
    "git branch --format='%(refname:short)'",
    { cwd: resolved, encoding: "utf-8", timeout: 5000 }
  ).trim();
  const locals = new Set(
    localRaw.split("\n").filter(Boolean).map((b) => b.replace(/'/g, ""))
  );

  // Remote branches (strip origin/ prefix, deduplicate against locals)
  const remoteRaw = execSync(
    "git branch -r --format='%(refname:short)'",
    { cwd: resolved, encoding: "utf-8", timeout: 5000 }
  ).trim();
  const remotes = remoteRaw
    .split("\n")
    .filter(Boolean)
    .map((b) => b.replace(/'/g, "").replace(/^origin\//, ""))
    .filter((b) => b !== "HEAD" && !locals.has(b));

  return [...locals, ...remotes];
}

/**
 * Get branches instantly from cache, kick off a background fetch.
 * Call again after a few seconds to get updated list.
 */
export async function getCurrentBranch(localPath: string): Promise<string | null> {
  if (!localPath?.trim()) return null;
  const resolved = path.resolve(expandHome(localPath));
  try {
    return readCurrentBranch(resolved);
  } catch {
    return null;
  }
}

export async function getProjectBranches(localPath: string): Promise<string[]> {
  if (!localPath?.trim()) return [];
  const resolved = path.resolve(expandHome(localPath));
  try {
    return readBranches(resolved);
  } catch {
    return [];
  }
}

/**
 * Trigger a background git fetch --prune, returns immediately.
 * Call getProjectBranches again after this completes for updated list.
 */
export async function fetchRemoteBranches(localPath: string): Promise<void> {
  if (!localPath?.trim()) return;
  const resolved = path.resolve(expandHome(localPath));
  try {
    const child = spawn("git", ["fetch", "--prune"], {
      cwd: resolved,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
    // Ignore fetch errors (offline, no remote, etc.)
  }
}
