import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// GET: get git info for a path (branches, current branch, status)
export async function GET(request: NextRequest) {
  const dirPath = request.nextUrl.searchParams.get("path");
  if (!dirPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  try {
    const resolved = path.resolve(dirPath);
    const gitDir = path.join(resolved, ".git");

    if (!fs.existsSync(gitDir)) {
      return NextResponse.json({ isGit: false, path: resolved });
    }

    const opts = { cwd: resolved, encoding: "utf-8" as const, timeout: 5000 };

    // Current branch
    let currentBranch = "";
    try {
      currentBranch = execSync("git rev-parse --abbrev-ref HEAD", opts).trim();
    } catch {
      currentBranch = "HEAD";
    }

    // All local branches
    let branches: string[] = [];
    try {
      const raw = execSync("git branch --format='%(refname:short)'", opts).trim();
      branches = raw.split("\n").filter(Boolean).map((b) => b.replace(/'/g, ""));
    } catch {
      branches = [currentBranch];
    }

    // Remote branches
    let remoteBranches: string[] = [];
    try {
      const raw = execSync("git branch -r --format='%(refname:short)'", opts).trim();
      remoteBranches = raw
        .split("\n")
        .filter(Boolean)
        .map((b) => b.replace(/'/g, "").replace(/^origin\//, ""))
        .filter((b) => b !== "HEAD");
    } catch {
      // no remote
    }

    // Status summary
    let statusSummary = { modified: 0, staged: 0, untracked: 0 };
    try {
      const raw = execSync("git status --porcelain", opts).trim();
      if (raw) {
        const lines = raw.split("\n");
        statusSummary.modified = lines.filter((l) => l[1] === "M").length;
        statusSummary.staged = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;
        statusSummary.untracked = lines.filter((l) => l.startsWith("??")).length;
      }
    } catch {
      // ignore
    }

    return NextResponse.json({
      isGit: true,
      path: resolved,
      currentBranch,
      branches,
      remoteBranches,
      statusSummary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Expand ~ to home directory
function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// POST: perform git actions (init, checkout, clone)
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, path: dirPath, branch } = body;

  if (action === "clone") {
    const { url, path: clonePath } = body;
    if (!url || !clonePath) {
      return NextResponse.json({ error: "url and path required" }, { status: 400 });
    }
    const resolved = path.resolve(expandHome(clonePath));

    // If target already exists and has content, don't overwrite
    if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) {
      // Check if it's already a git repo
      if (fs.existsSync(path.join(resolved, ".git"))) {
        return NextResponse.json({ success: true, message: "already_cloned", path: resolved });
      }
      return NextResponse.json({ error: "Directory already exists and is not empty" }, { status: 400 });
    }

    try {
      // Create parent directories
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      execSync(`git clone ${JSON.stringify(url)} ${JSON.stringify(resolved)}`, {
        encoding: "utf-8",
        timeout: 120000, // 2 min for large repos
      });
      return NextResponse.json({ success: true, message: "cloned", path: resolved });
    } catch (e: any) {
      // Clean up empty dir on failure
      if (fs.existsSync(resolved) && fs.readdirSync(resolved).length === 0) {
        fs.rmdirSync(resolved);
      }
      return NextResponse.json({ error: e.message || "Clone failed" }, { status: 500 });
    }
  }

  if (!dirPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const resolved = path.resolve(expandHome(dirPath));
  const opts = { cwd: resolved, encoding: "utf-8" as const, timeout: 10000 };

  try {
    if (action === "init") {
      if (!fs.existsSync(resolved)) {
        return NextResponse.json({ error: "Directory not found" }, { status: 400 });
      }
      execSync("git init", opts);
      execSync("git add -A", opts);
      try {
        execSync('git commit -m "Initial commit" --allow-empty', opts);
      } catch {
        // may fail if no user configured, that's ok
      }
      return NextResponse.json({ success: true, message: "Git repository initialized" });
    }

    if (action === "checkout" && branch) {
      // Check if branch exists locally
      try {
        execSync(`git rev-parse --verify ${branch}`, opts);
        execSync(`git checkout ${branch}`, opts);
      } catch {
        // Try checking out remote branch
        try {
          execSync(`git checkout -b ${branch} origin/${branch}`, opts);
        } catch {
          return NextResponse.json({ error: `Branch "${branch}" not found` }, { status: 400 });
        }
      }
      return NextResponse.json({ success: true, branch });
    }

    if (action === "create-branch") {
      const { branch, baseBranch } = body;
      if (!branch) {
        return NextResponse.json({ error: "branch name required" }, { status: 400 });
      }
      // Sanitize branch name
      const safeBranch = branch.replace(/[^a-zA-Z0-9_\-\/\.]/g, "-");
      const base = baseBranch || "HEAD";
      try {
        execSync(`git checkout -b ${safeBranch} ${base}`, opts);
      } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to create branch" }, { status: 400 });
      }
      return NextResponse.json({ success: true, branch: safeBranch });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
