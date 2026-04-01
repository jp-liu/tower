"use server";

import { execSync } from "child_process";
import path from "path";
import os from "os";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export async function getProjectBranches(localPath: string): Promise<string[]> {
  if (!localPath?.trim()) return [];
  const resolved = path.resolve(expandHome(localPath));
  try {
    // Fetch latest remote refs (best-effort, don't block on failure)
    try {
      execSync("git fetch --prune", { cwd: resolved, encoding: "utf-8", timeout: 15000, stdio: "ignore" });
    } catch {
      // Fetch failed (offline, no remote, etc.) — continue with cached refs
    }

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

    // Local branches first, then remote-only branches
    return [...locals, ...remotes];
  } catch {
    return [];
  }
}
