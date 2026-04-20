import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
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
    const resolved = path.resolve(expandHome(dirPath));
    const gitDir = path.join(resolved, ".git");

    if (!fs.existsSync(gitDir)) {
      return NextResponse.json({ isGit: false, path: resolved });
    }

    const opts = { cwd: resolved, encoding: "utf-8" as const, timeout: 5000 };

    // Current branch
    let currentBranch = "";
    try {
      currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts).trim();
    } catch {
      currentBranch = "HEAD";
    }

    // All local branches
    let branches: string[] = [];
    try {
      const raw = execFileSync("git", ["branch", "--format=%(refname:short)"], opts).trim();
      branches = raw.split("\n").filter(Boolean);
    } catch {
      branches = [currentBranch];
    }

    // Remote branches
    let remoteBranches: string[] = [];
    try {
      const raw = execFileSync("git", ["branch", "-r", "--format=%(refname:short)"], opts).trim();
      remoteBranches = raw
        .split("\n")
        .filter(Boolean)
        .map((b: string) => b.replace(/^origin\//, ""))
        .filter((b: string) => b !== "HEAD");
    } catch {
      // no remote
    }

    // Status summary
    let statusSummary = { modified: 0, staged: 0, untracked: 0 };
    try {
      const raw = execFileSync("git", ["status", "--porcelain"], opts).trim();
      if (raw) {
        const lines = raw.split("\n");
        statusSummary.modified = lines.filter((l: string) => l[1] === "M").length;
        statusSummary.staged = lines.filter((l: string) => l[0] !== " " && l[0] !== "?").length;
        statusSummary.untracked = lines.filter((l: string) => l.startsWith("??")).length;
      }
    } catch {
      // ignore
    }

    // Remote URL (origin)
    let remoteUrl = "";
    try {
      remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], opts).trim();
    } catch {
      // no remote configured
    }

    // Worktree check (optional)
    let hasWorktrees = false;
    if (request.nextUrl.searchParams.get("checkWorktrees") === "true") {
      try {
        const raw = execFileSync("git", ["worktree", "list", "--porcelain"], opts).trim();
        // More than one worktree entry means linked worktrees exist
        const worktreeEntries = raw.split("\n\n").filter(Boolean);
        hasWorktrees = worktreeEntries.length > 1;
      } catch {
        // git worktree not supported or error — treat as no worktrees
      }
    }

    return NextResponse.json({
      isGit: true,
      path: resolved,
      currentBranch,
      branches,
      remoteBranches,
      remoteUrl,
      statusSummary,
      hasWorktrees,
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
      execFileSync("git", ["clone", url, resolved], {
        encoding: "utf-8",
        timeout: 120000,
      });
      return NextResponse.json({ success: true, message: "cloned", path: resolved });
    } catch (e: unknown) {
      // Clean up empty dir on failure
      if (fs.existsSync(resolved) && fs.readdirSync(resolved).length === 0) {
        fs.rmdirSync(resolved);
      }
      return NextResponse.json({ error: (e as Error).message || "Clone failed" }, { status: 500 });
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
      execFileSync("git", ["init"], opts);
      execFileSync("git", ["add", "-A"], opts);
      try {
        execFileSync("git", ["commit", "-m", "Initial commit", "--allow-empty"], opts);
      } catch {
        // may fail if no user configured, that's ok
      }
      return NextResponse.json({ success: true, message: "Git repository initialized" });
    }

    if (action === "checkout" && branch) {
      // Sanitize branch name
      const safeBranch = branch.replace(/[^a-zA-Z0-9_\-\/\.]/g, "");
      if (!safeBranch) return NextResponse.json({ error: "Invalid branch name" }, { status: 400 });
      try {
        execFileSync("git", ["rev-parse", "--verify", safeBranch], opts);
        execFileSync("git", ["checkout", safeBranch], opts);
      } catch {
        try {
          execFileSync("git", ["checkout", "-b", safeBranch, `origin/${safeBranch}`], opts);
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
      const base = (baseBranch || "HEAD").replace(/[^a-zA-Z0-9_\-\/\.]/g, "");
      try {
        execFileSync("git", ["checkout", "-b", safeBranch, base], opts);
      } catch (err: unknown) {
        return NextResponse.json({ error: (err as Error).message || "Failed to create branch" }, { status: 400 });
      }
      return NextResponse.json({ success: true, branch: safeBranch });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
