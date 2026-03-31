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
    const raw = execSync(
      "git branch --format='%(refname:short)'",
      { cwd: resolved, encoding: "utf-8", timeout: 5000 }
    ).trim();
    return raw.split("\n").filter(Boolean).map((b) => b.replace(/'/g, ""));
  } catch {
    return [];
  }
}
